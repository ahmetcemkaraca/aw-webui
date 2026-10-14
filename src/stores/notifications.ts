import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';

// Match the native catalog; never display bridge-supplied notification copy.
const NOTICE_COPY = {
  welcome: {
    title: 'Welcome to PeakActivity',
    body: 'Welcome to PeakActivity! Click on the tray icon to launch the dashboard.',
    review_source: 'home',
  },
  'recording-control-failed': {
    title: 'Recording control needs attention',
    body: 'PeakActivity could not change recording. Review your privacy settings.',
    review_source: 'privacy',
  },
  'capture-source-unavailable': {
    title: 'Capture source needs attention',
    body: 'A capture source is unavailable. Review your privacy settings.',
    review_source: 'privacy',
  },
  'capture-source-stopped': {
    title: 'Capture source stopped',
    body: 'A capture source stopped unexpectedly. Review your privacy settings.',
    review_source: 'privacy',
  },
  'local-notice': {
    title: 'Local PeakActivity notice',
    body: 'PeakActivity has a local update. Review the dashboard for details.',
    review_source: 'home',
  },
} as const;

type NoticeCode = keyof typeof NOTICE_COPY;
export type ReviewSource = 'home' | 'privacy' | 'categorization';
export interface NotificationEntry {
  id: string;
  created_at: string;
  code: NoticeCode;
  delivery: 'unknown' | 'attempted' | 'failed' | 'suppressed';
  title: string;
  body: string;
  review_source: ReviewSource;
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

function validDate(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19);
}

function validateHistory(value: unknown): NotificationEntry[] {
  if (!exactKeys(value, ['schema_version', 'limit', 'permission', 'entries'])
    || value.schema_version !== 1 || value.limit !== 200 || value.permission !== 'unknown'
    || !Array.isArray(value.entries) || value.entries.length > 200) throw new Error('Invalid notification history');
  const ids = new Set<string>();
  const entries = value.entries.map(entry => {
    if (!exactKeys(entry, ['id', 'created_at', 'code', 'delivery', 'title', 'body', 'review_source'])
      || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{21}[AQgw]$/.test(entry.id)
      || ids.has(entry.id) || !validDate(entry.created_at)
      || typeof entry.code !== 'string' || !Object.prototype.hasOwnProperty.call(NOTICE_COPY, entry.code)
      || !['unknown', 'attempted', 'failed', 'suppressed'].includes(entry.delivery as string)) {
      throw new Error('Invalid notification entry');
    }
    const code = entry.code as NoticeCode;
    const copy = NOTICE_COPY[code];
    if (entry.title !== copy.title || entry.body !== copy.body || entry.review_source !== copy.review_source) {
      throw new Error('Invalid notification copy');
    }
    ids.add(entry.id);
    return {
      id: entry.id, created_at: entry.created_at, code,
      delivery: entry.delivery as NotificationEntry['delivery'], ...copy,
    };
  });
  return entries.reverse();
}

export const useNotificationsStore = defineStore('notifications', () => {
  const entries = ref<NotificationEntry[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref('');
  const nativeAvailable = computed(() => typeof nativeBridge()?.invoke === 'function');
  let operation = 0;
  let disposed = false;

  function clearSensitive() {
    operation += 1;
    entries.value = [];
    loading.value = false;
    loaded.value = false;
    error.value = '';
  }
  onScopeDispose(() => { disposed = true; clearSensitive(); });

  async function refresh() {
    if (disposed) return;
    const current = ++operation;
    loading.value = true;
    error.value = '';
    try {
      const bridge = nativeBridge();
      if (!bridge || typeof bridge.invoke !== 'function') {
        error.value = 'Open Notifications in PeakActivity desktop.';
        return;
      }
      const result = await bridge.invoke('notification_history');
      if (current !== operation) return;
      entries.value = validateHistory(result);
      loaded.value = true;
    } catch (_) {
      if (current === operation) error.value = 'Notification history could not be loaded. Refresh or clear the local history to try again.';
    } finally {
      if (current === operation) loading.value = false;
    }
  }

  async function clear() {
    if (disposed) return;
    const current = ++operation;
    loading.value = true;
    error.value = '';
    try {
      const bridge = nativeBridge();
      if (!bridge || typeof bridge.invoke !== 'function') {
        error.value = 'Open Notifications in PeakActivity desktop.';
        return;
      }
      const result = await bridge.invoke('clear_notification_history');
      if (current !== operation) return;
      const cleared = validateHistory(result);
      if (cleared.length) throw new Error('Invalid clear acknowledgement');
      entries.value = [];
      loaded.value = true;
    } catch (_) {
      if (current === operation) error.value = 'Notification history could not be cleared. Try again.';
    } finally {
      if (current === operation) loading.value = false;
    }
  }

  return { entries, loading, loaded, error, nativeAvailable, refresh, clear, clearSensitive };
});
