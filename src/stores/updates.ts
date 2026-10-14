import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';

export interface UpdateIntegrityStatus {
  schema_version: 1;
  state: 'not-configured' | 'ready' | 'unavailable';
  installed_version: string;
  platform: 'windows' | 'macos' | 'linux';
  native_architecture: 'x86_64' | 'arm64';
}

export interface VerifiedBundle {
  schema_version: 1;
  version: string;
  channel: 'stable' | 'beta' | 'preview';
  support_status: 'supported' | 'limited';
  platform: UpdateIntegrityStatus['platform'];
  native_architecture: UpdateIntegrityStatus['native_architecture'];
  artifact_architecture: 'x86_64' | 'arm64' | 'universal';
  source_revision: string;
  manifest_fingerprint: string;
  artifact_fingerprint: string;
  local_integrity: 'verified';
  public_readback: 'not-checked';
  platform_signature: 'not-checked';
  release_freshness: 'not-checked';
  key_lifecycle: 'not-checked';
}

function nativeBridge() {
  return typeof window === 'undefined' ? undefined : (window as unknown as {
    __TAURI__?: { core?: { invoke: (command: string) => Promise<unknown> } };
  }).__TAURI__?.core;
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function version(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64000
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function validateStatus(value: unknown): UpdateIntegrityStatus {
  if (!exactKeys(value, ['schema_version', 'state', 'installed_version', 'platform', 'native_architecture'])
    || value.schema_version !== 1 || !['not-configured', 'ready', 'unavailable'].includes(value.state as string)
    || !version(value.installed_version) || !['windows', 'macos', 'linux'].includes(value.platform as string)
    || !['x86_64', 'arm64'].includes(value.native_architecture as string)) {
    throw new Error('Invalid release verification status');
  }
  return { ...value } as unknown as UpdateIntegrityStatus;
}

function validateBundle(value: unknown, target: UpdateIntegrityStatus): VerifiedBundle {
  const fingerprint = value => typeof value === 'string' && /^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/.test(value);
  if (!exactKeys(value, ['schema_version', 'version', 'channel', 'support_status', 'platform',
    'native_architecture', 'artifact_architecture', 'source_revision', 'manifest_fingerprint',
    'artifact_fingerprint', 'local_integrity', 'public_readback', 'platform_signature', 'release_freshness', 'key_lifecycle'])
    || value.schema_version !== 1 || !version(value.version)
    || !['stable', 'beta', 'preview'].includes(value.channel as string)
    || !['supported', 'limited'].includes(value.support_status as string)
    || value.platform !== target.platform || value.native_architecture !== target.native_architecture
    || !(value.artifact_architecture === target.native_architecture
      || (target.platform === 'macos' && value.artifact_architecture === 'universal'))
    || typeof value.source_revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.source_revision)
    || !fingerprint(value.manifest_fingerprint) || !fingerprint(value.artifact_fingerprint)
    || value.local_integrity !== 'verified'
    || value.public_readback !== 'not-checked' || value.platform_signature !== 'not-checked'
    || value.release_freshness !== 'not-checked' || value.key_lifecycle !== 'not-checked') {
    throw new Error('Invalid release verification result');
  }
  return { ...value } as unknown as VerifiedBundle;
}

export const useUpdatesStore = defineStore('updates', () => {
  const status = ref<UpdateIntegrityStatus | null>(null);
  const result = ref<VerifiedBundle | null>(null);
  const loading = ref(false);
  const error = ref('');
  const cancelled = ref(false);
  const nativeAvailable = computed(() => typeof nativeBridge()?.invoke === 'function');
  let operation = 0;
  let disposed = false;

  function clearSensitive() {
    operation += 1;
    status.value = result.value = null;
    loading.value = cancelled.value = false;
    error.value = '';
  }
  onScopeDispose(() => { disposed = true; clearSensitive(); });

  async function refreshStatus() {
    if (disposed || loading.value) return;
    clearSensitive();
    const current = operation;
    loading.value = true;
    try {
      const bridge = nativeBridge();
      if (typeof bridge?.invoke !== 'function') {
        error.value = 'Open Updates in PeakActivity desktop.';
        return;
      }
      const value = await bridge.invoke('update_integrity_status');
      if (current !== operation) return;
      status.value = validateStatus(value);
    } catch (_) {
      if (current === operation) error.value = 'Release verification status could not be loaded. Try again.';
    } finally {
      if (current === operation) loading.value = false;
    }
  }

  async function verifyBundle() {
    if (disposed || loading.value || status.value?.state !== 'ready') return;
    const target = status.value;
    const current = ++operation;
    result.value = null;
    cancelled.value = false;
    error.value = '';
    loading.value = true;
    try {
      const bridge = nativeBridge();
      if (typeof bridge?.invoke !== 'function') {
        error.value = 'Open Updates in PeakActivity desktop.';
        return;
      }
      const value = await bridge.invoke('verify_update_bundle');
      if (current !== operation) return;
      if (value === null) cancelled.value = true;
      else result.value = validateBundle(value, target);
    } catch (_) {
      if (current === operation) error.value = 'The local release bundle could not be verified. Check the bundle and try again.';
    } finally {
      if (current === operation) loading.value = false;
    }
  }

  return { status, result, loading, error, cancelled, nativeAvailable, refreshStatus, verifyBundle, clearSensitive };
});
