import { onScopeDispose, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { getClient, invokeAndroidNative } from '~/util/awclient';
import { strictJson, utf8Bytes } from '~/util/strictJson';
import {
  backupCatalogue,
  backupDeletePreview,
  backupDeleteOutcome,
  backupProviderPreview,
  backupRestorePreview,
  backupSelection,
  type BackupVersion,
  type BackupSelection,
} from '~/util/backupContracts';
async function native(command: string, args?: object): Promise<any> {
  if ((window as any).Android) return invokeAndroidNative(command, args);
  const bridge = (window as any).__TAURI__;
  if (!bridge) throw new Error('Open this control in PeakActivity.');
  return bridge.core.invoke(command, args);
}
export const useBackupStore = defineStore('backups', () => {
  const versions = shallowRef<BackupVersion[]>([]),
    selected = shallowRef<BackupSelection | null>(null),
    catalogue = shallowRef<any>(null);
  const providerPreview = shallowRef<any>(null),
    restorePreview = shallowRef<any>(null),
    transfer = shallowRef<any>(null),
    deletePreview = shallowRef<any>(null),
    deleteOutcome = shallowRef<any>(null),
    deletionSelected = shallowRef<BackupSelection | null>(null);
  const mode = ref<'local' | 'folder'>('local'),
    folderPath = ref(''),
    kitRaw = ref(''),
    phrase = ref(''),
    exportRaw = ref(''),
    busy = ref(false),
    error = ref(''),
    restored = ref(false);
  let generation = 0,
    sequence = 0,
    disposed = false,
    contextId: string | undefined,
    reviewSource = '',
    deleteReviewSource = '';
  const destinations = shallowRef<string[]>([]),
    providerAllowed = ref(false),
    cleanupAllowed = ref(false);
  const controllers = new Set<AbortController>();
  const owned = (t: { generation: number; sequence: number }) =>
    !disposed && t.generation === generation && t.sequence === sequence;
  function invalidate() {
    generation++;
    sequence++;
    controllers.forEach(c => c.abort());
    controllers.clear();
    busy.value = false;
  }
  function clearResults() {
    versions.value = [];
    selected.value = null;
    catalogue.value = null;
    providerPreview.value = null;
    restorePreview.value = null;
    transfer.value = null;
    deletePreview.value = deleteOutcome.value = null;
    deletionSelected.value = null;
    deleteReviewSource = '';
    exportRaw.value = '';
    restored.value = false;
    reviewSource = '';
  }
  function clearSensitive() {
    invalidate();
    clearResults();
    folderPath.value = kitRaw.value = phrase.value = '';
    mode.value = 'local';
    contextId = undefined;
    destinations.value = [];
    providerAllowed.value = cleanupAllowed.value = false;
    error.value = '';
  }
  onScopeDispose(() => {
    disposed = true;
    clearSensitive();
  });
  function configure(input: {
    mode: 'local' | 'folder';
    folderPath: string;
    kitRaw: string;
    phrase: string;
  }) {
    if (
      input.mode === mode.value &&
      input.folderPath === folderPath.value &&
      input.kitRaw === kitRaw.value &&
      input.phrase === phrase.value
    )
      return;
    invalidate();
    clearResults();
    mode.value = input.mode;
    folderPath.value = input.folderPath;
    kitRaw.value = input.kitRaw;
    phrase.value = input.phrase;
    error.value = '';
  }
  async function ready(t: any) {
    if (!owned(t)) return false;
    let result: any;
    try {
      result = await native('get_sync_backup_context');
    } catch (_) {
      if (owned(t)) {
        clearSensitive();
        error.value = 'Unlock the encrypted vault and list again.';
      }
      return false;
    }
    if (!owned(t)) return false;
    if (!result || result.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(result.context_id))
      throw new Error('Unlock the encrypted vault.');
    if (contextId !== undefined && contextId !== result.context_id) {
      clearSensitive();
      error.value = 'The vault changed. List and review again.';
      return false;
    }
    contextId = result.context_id;
    return true;
  }
  function sourceJson(withSelection = false, localKeys = false, deletion = false) {
    const body: any = {
      schema_version: 1,
      context_id: contextId,
      source_id: localKeys ? 'local' : mode.value,
    };
    if (!localKeys && mode.value === 'folder') body.folder_path = folderPath.value;
    if (withSelection) {
      const reference = deletion ? deletionSelected.value : selected.value;
      if (!reference) throw new Error('Select an authenticated backup.');
      body.selection = reference;
    }
    let raw = JSON.stringify(body);
    if (kitRaw.value || phrase.value) {
      if (!kitRaw.value || !phrase.value)
        throw new Error('Provide both the recovery kit and its phrase.');
      const kit = strictJson(kitRaw.value, 64 * 1024).value;
      if (!kit || typeof kit !== 'object' || Array.isArray(kit))
        throw new Error('Paste a recovery kit object.');
      raw =
        raw.slice(0, -1) +
        ',"recovery":{"kit":' +
        kitRaw.value +
        ',"phrase":' +
        JSON.stringify(phrase.value) +
        '}}';
    }
    if (utf8Bytes(raw) > 64 * 1024) throw new Error('The backup request is too large.');
    return raw;
  }
  async function task(action: (t: any) => Promise<void>) {
    if (disposed || busy.value) return;
    const t = { generation, sequence: ++sequence };
    busy.value = true;
    error.value = '';
    try {
      if (await ready(t)) await action(t);
    } catch (_) {
      if (owned(t)) {
        clearResults();
        error.value = 'The backup operation failed. Unlock, list and review again.';
      }
    } finally {
      if (owned(t)) busy.value = false;
    }
  }
  async function rawPost(path: string, body: unknown) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const response = await getClient().req.post('/0/sync/backups/' + path, body, {
        signal: controller.signal,
        responseType: 'text',
        transformResponse: [(data: any) => data],
      });
      if (typeof response.data !== 'string') throw new Error('Invalid backup response.');
      return response.data;
    } finally {
      controllers.delete(controller);
    }
  }
  async function load() {
    await task(async t => {
      clearResults();
      const result = backupCatalogue(
        await native('list_sync_backups', { requestJson: sourceJson() })
      );
      if (!(await ready(t))) return;
      if (result.context_id !== contextId) throw new Error('Changed context.');
      catalogue.value = result;
      versions.value = result.versions;
    });
  }
  function select(row: BackupVersion) {
    if (busy.value) return;
    invalidate();
    selected.value = null;
    deletionSelected.value = null;
    deletePreview.value = deleteOutcome.value = null;
    deleteReviewSource = '';
    providerPreview.value = null;
    restorePreview.value = null;
    exportRaw.value = '';
    transfer.value = null;
    reviewSource = '';
    if (versions.value.includes(row) && row.status === 'authenticated' && row.selection)
      selected.value = row.selection;
  }
  function selectDeletion(row: BackupVersion) {
    if (busy.value || !versions.value.includes(row) || row.current || !row.deletion_selection)
      return;
    select(row);
    deletionSelected.value = row.deletion_selection;
  }
  async function previewDelete() {
    await task(async t => {
      if (deletionSelected.value?.source_id.startsWith('relay-'))
        throw new Error('Review provider cleanup.');
      const source = sourceJson(true, false, true);
      const result = backupDeletePreview(
        await native('preview_sync_backup_delete', { requestJson: source }),
        contextId!
      );
      if (!(await ready(t))) return;
      if (JSON.stringify(result.selection) !== JSON.stringify(deletionSelected.value))
        throw new Error('Changed deletion selection.');
      deletePreview.value = result;
      deleteReviewSource = source;
    });
  }
  async function deleteSelected(accepted: boolean) {
    if (!accepted || !deletePreview.value) return;
    await task(async t => {
      if (deleteReviewSource !== sourceJson(true, false, true))
        throw new Error('Review deletion again.');
      const result = backupDeleteOutcome(
        await native('delete_selected_sync_backup', {
          requestJson: deleteReviewSource,
          userAccepted: true,
        }),
        contextId!
      );
      if (!(await ready(t))) return;
      if (
        JSON.stringify(result.selection) !== JSON.stringify(deletionSelected.value) ||
        result.copy_scope !== deletePreview.value.copy_scope
      )
        throw new Error('Changed deletion result.');
      deletePreview.value = null;
      deleteReviewSource = '';
      selected.value = null;
      exportRaw.value = '';
      restorePreview.value = null;
      versions.value = [];
      catalogue.value = null;
      deleteOutcome.value = result;
    });
  }
  async function create() {
    const owner = generation;
    let created = false;
    await task(async t => {
      clearResults();
      await native('create_current_sync_snapshot');
      if (!(await ready(t))) return;
      created = true;
    });
    if (created && owner === generation && !disposed) await load();
  }
  async function exportSelected() {
    await task(async t => {
      const raw = await native('export_selected_sync_backup', { requestJson: sourceJson(true) });
      if (!(await ready(t))) return;
      if (typeof raw !== 'string') throw new Error('Invalid encrypted export.');
      exportRaw.value = raw;
    });
  }
  async function previewRestore() {
    await task(async t => {
      if (!kitRaw.value || !phrase.value) throw new Error('A matching recovery kit is required.');
      const result = backupRestorePreview(
        await native('preview_selected_sync_backup_restore', { requestJson: sourceJson(true) })
      );
      if (!(await ready(t))) return;
      if (
        result.snapshot_id !== selected.value?.snapshot_id ||
        result.vault_id !== selected.value?.vault_id ||
        result.key_epoch !== selected.value?.key_epoch
      )
        throw new Error('Changed selection.');
      restorePreview.value = result;
      reviewSource = sourceJson(true);
    });
  }
  async function restoreSelected(accepted: boolean) {
    if (!accepted || !restorePreview.value) return;
    await task(async t => {
      if (reviewSource !== sourceJson(true)) throw new Error('Review again.');
      const result = await native('restore_selected_sync_backup', {
        requestJson: reviewSource,
        userAccepted: true,
      });
      if (!owned(t)) return;
      backupRestorePreview(result);
      clearSensitive();
      restored.value = true;
    });
  }
  async function refreshProvider() {
    await task(async t => {
      destinations.value = [];
      providerAllowed.value = cleanupAllowed.value = false;
      const client = getClient().req;
      const options = { responseType: 'text' as const, transformResponse: [(v: any) => v] };
      const [statusReply, accessReply, policyReply] = await Promise.all([
        client.get('/0/egress/status', options),
        client.get('/0/entitlements/', options).catch(() => ({ data: '{"sync_allowed":false}' })),
        client.get('/0/egress/policy', options),
      ]);
      const status = strictJson(statusReply.data, 128 * 1024).value,
        access = strictJson(accessReply.data, 128 * 1024).value,
        policy = strictJson(policyReply.data, 4 * 1024 * 1024).value;
      if (!(await ready(t))) return;
      if (!Array.isArray(policy.purposes) || !Array.isArray(policy.destinations))
        throw new Error('Invalid signed policy.');
      const ids = policy.purposes
        .filter((p: any) => p.id === 'sync-object-v1')
        .map((p: any) => p.destination_id);
      destinations.value = policy.destinations
        .filter(
          (d: any) =>
            ids.includes(d.id) &&
            ['available', 'beta', 'experimental'].includes(d.status) &&
            typeof d.id === 'string' &&
            /^[a-z][a-z0-9_.-]{0,63}$/.test(d.id)
        )
        .map((d: any) => d.id);
      cleanupAllowed.value =
        status.outbound_enabled === true &&
        status.kill_switch_enabled === false &&
        status.trusted_policy_keys > 0 &&
        destinations.value.length > 0;
      providerAllowed.value = cleanupAllowed.value && access.sync_allowed === true;
    });
  }
  async function reviewProvider(
    operation: 'list' | 'cleanup_list' | 'delete' | 'upload' | 'download',
    destinationId: string
  ) {
    await task(async t => {
      const cleanup = ['cleanup_list', 'delete'].includes(operation);
      if (
        !(cleanup ? cleanupAllowed.value : providerAllowed.value) ||
        !destinations.value.includes(destinationId)
      )
        throw new Error('Refresh provider availability first.');
      providerPreview.value = null;
      transfer.value = null;
      restorePreview.value = null;
      const rawSource = sourceJson(operation === 'upload', operation !== 'upload');
      const selection =
        operation === 'delete'
          ? deletionSelected.value
          : operation === 'download'
          ? selected.value
          : null;
      if (['download', 'delete'].includes(operation) && !selection)
        throw new Error('Select a provider backup.');
      const raw = await rawPost('preview', {
        schema_version: 1,
        context_id: contextId,
        operation,
        destination_id: destinationId,
        source_json: rawSource,
        selection,
      });
      if (!(await ready(t))) return;
      const result = backupProviderPreview(raw, contextId!);
      const expected = operation === 'upload' ? selected.value : selection;
      if (
        result.operation !== operation ||
        result.destination_id !== destinationId ||
        (expected &&
          (result.snapshot_id !== expected.snapshot_id ||
            result.bundle_sha256 !== expected.bundle_sha256 ||
            result.key_epoch !== expected.key_epoch ||
            result.vault_id !== expected.vault_id ||
            (operation === 'delete'
              ? result.object_count > expected.object_count
              : result.object_count !== expected.object_count) ||
            result.source_id !== expected.source_id))
      )
        throw new Error('Changed review.');
      providerPreview.value = result;
      reviewSource = rawSource;
    });
  }
  async function runProvider(accepted: boolean) {
    if (!accepted || !providerPreview.value) return;
    await task(async t => {
      const reviewed = providerPreview.value,
        source = reviewSource,
        deletion = deletionSelected.value;
      if (source !== sourceJson(reviewed.operation === 'upload', reviewed.operation !== 'upload'))
        throw new Error('Review again.');
      const job = strictJson(
        await rawPost('approve', {
          schema_version: 1,
          context_id: contextId,
          preview_id: reviewed.preview_id,
          user_accepted: true,
          source_json: source,
        }),
        128 * 1024
      ).value;
      if (!(await ready(t))) return;
      if (
        job.schema_version !== 1 ||
        job.context_id !== contextId ||
        !/^[a-f0-9]{64}$/.test(job.job_id)
      )
        throw new Error('Invalid provider job.');
      providerPreview.value = null;
      reviewSource = '';
      const result = strictJson(
        await rawPost('run', {
          schema_version: 1,
          context_id: contextId,
          job_id: job.job_id,
          source_json: source,
        }),
        32 * 1024 * 1024
      ).value;
      if (!(await ready(t))) return;
      if (['list', 'cleanup_list'].includes(reviewed.operation)) {
        const page = backupCatalogue(result);
        if (page.context_id !== contextId || page.source_id !== reviewed.source_id)
          throw new Error('Changed catalogue.');
        catalogue.value = page;
        versions.value = page.versions;
        selected.value = null;
        deletionSelected.value = null;
        deletePreview.value = deleteOutcome.value = null;
        deleteReviewSource = '';
        exportRaw.value = '';
      } else if (reviewed.operation === 'delete') {
        const outcome = backupDeleteOutcome(result, contextId!);
        if (
          outcome.selection.snapshot_id !== reviewed.snapshot_id ||
          outcome.selection.bundle_sha256 !== reviewed.bundle_sha256 ||
          outcome.selection.source_id !== reviewed.source_id ||
          !deletion ||
          Object.keys(deletion).some(key => outcome.selection[key] !== deletion[key]) ||
          outcome.copy_scope !== 'provider'
        )
          throw new Error('Changed cleanup result.');
        selected.value = null;
        exportRaw.value = '';
        restorePreview.value = null;
        versions.value = [];
        catalogue.value = null;
        deleteOutcome.value = outcome;
      } else {
        if (
          result.schema_version !== 1 ||
          result.context_id !== contextId ||
          !['partial', 'complete'].includes(result.status) ||
          result.object_count !== reviewed.object_count ||
          !Number.isSafeInteger(result.completed_objects) ||
          result.completed_objects < 0 ||
          result.completed_objects > result.object_count ||
          (result.status === 'complete' && result.completed_objects !== result.object_count)
        )
          throw new Error('Invalid transfer result.');
        if (result.local_selection !== null) {
          const local = backupSelection(result.local_selection);
          if (
            reviewed.operation !== 'download' ||
            result.status !== 'complete' ||
            local.source_id !== 'local' ||
            local.snapshot_id !== reviewed.snapshot_id ||
            local.bundle_sha256 !== reviewed.bundle_sha256
          )
            throw new Error('Invalid downloaded selection.');
          mode.value = 'local';
          folderPath.value = '';
          selected.value = local;
          catalogue.value = null;
          versions.value = [];
        } else if (reviewed.operation === 'download' && result.status === 'complete')
          throw new Error('Missing downloaded selection.');
        transfer.value = result;
      }
    });
  }
  return {
    versions,
    selected,
    catalogue,
    providerPreview,
    restorePreview,
    transfer,
    deletePreview,
    deleteOutcome,
    deletionSelected,
    selectDeletion,
    previewDelete,
    deleteSelected,
    cleanupAllowed,
    mode,
    folderPath,
    kitRaw,
    phrase,
    exportRaw,
    busy,
    error,
    restored,
    configure,
    clearSensitive,
    load,
    select,
    create,
    exportSelected,
    previewRestore,
    restoreSelected,
    reviewProvider,
    runProvider,
    refreshProvider,
    destinations,
    providerAllowed,
  };
});
