import { createPinia, setActivePinia } from 'pinia';
import { useNotificationsStore } from '~/stores/notifications';

const first = {
  id: 'AQEBAQEBAQEBAQEBAQEBAQ',
  created_at: '2026-10-13T09:00:00Z',
  code: 'welcome',
  delivery: 'attempted',
  title: 'Welcome to PeakActivity',
  body: 'Welcome to PeakActivity! Click on the tray icon to launch the dashboard.',
  review_source: 'home',
};
const second = {
  id: 'AgICAgICAgICAgICAgICAg',
  created_at: '2026-10-13T09:01:00.123456789Z',
  code: 'capture-source-stopped',
  delivery: 'failed',
  title: 'Capture source stopped',
  body: 'A capture source stopped unexpectedly. Review your privacy settings.',
  review_source: 'privacy',
};
const history = (entries: object[] = []) => ({ schema_version: 1, limit: 200, permission: 'unknown', entries });
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('bounded local notification history', () => {
  let invoke: jest.Mock;
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = jest.fn();
    (global as any).window = { __TAURI__: { core: { invoke } } };
  });
  afterEach(() => { delete (global as any).window; });

  test('loads safe native history newest first without upgrading delivery or permission', async () => {
    const store = useNotificationsStore();
    invoke.mockResolvedValue(history([first, second]));
    await store.refresh();
    expect(store.entries).toEqual([second, first]);
    expect(store.entries[1].delivery).toBe('attempted');
    expect(store.loaded).toBe(true);
    expect(store.error).toBe('');
    expect(invoke).toHaveBeenCalledWith('notification_history');
  });

  test('keeps the most recently received notification first after the clock moves backwards', async () => {
    const earlierArrival = { ...first, created_at: '2100-10-13T09:00:00Z' };
    invoke.mockResolvedValue(history([earlierArrival, second]));
    const store = useNotificationsStore();
    await store.refresh();
    expect(store.entries).toEqual([second, earlierArrival]);
  });

  test.each([
    ['schema version', { ...history(), schema_version: 2 }],
    ['entry count', history(Array.from({ length: 201 }, () => first))],
    ['native limit', { ...history(), limit: 201 }],
    ['permission claim', { ...history(), permission: 'granted' }],
    ['root tuple', [1, 200, 'unknown', []]],
    ['entries tuple', { ...history(), entries: {} }],
    ['unknown root fields', { ...history(), raw_path: '/private/path' }],
    ['duplicate IDs', history([first, first])],
    ['invalid ID length', history([{ ...first, id: 'short' }])],
    ['noncanonical ID bits', history([{ ...first, id: 'AQEBAQEBAQEBAQEBAQEBAZ' }])],
    ['unknown code', history([{ ...first, code: 'private-helper-error' }])],
    ['unknown delivery', history([{ ...first, delivery: 'displayed' }])],
    ['arbitrary source path', history([{ ...first, review_source: '/private/activity' }])],
    ['wrong source for code', history([{ ...first, review_source: 'categorization' }])],
    ['raw title', history([{ ...first, title: 'PRIVATE_ACTIVITY_TITLE' }])],
    ['raw body', history([{ ...first, body: 'SECRET_BEARER_TOKEN' }])],
    ['unknown entry fields', history([{ ...first, route: 'https://example.test' }])],
    ['entry tuple', history([Object.values(first)])],
    ['missing field', history([{ ...first, title: undefined }])],
    ['invalid date', history([{ ...first, created_at: 'not a date' }])],
    ['normalized invalid calendar date', history([{ ...first, created_at: '2026-02-30T09:00:00Z' }])],
    ['non-UTC date', history([{ ...first, created_at: '2026-10-13T09:00:00+01:00' }])],
    ['date without zone', history([{ ...first, created_at: '2026-10-13T09:00:00' }])],
  ])('rejects %s privately', async (_name, payload) => {
    const store = useNotificationsStore();
    invoke.mockResolvedValue(payload);
    await store.refresh();
    expect(store.entries).toEqual([]);
    expect(store.loaded).toBe(false);
    expect(store.error).toBe('Notification history could not be loaded. Refresh or clear the local history to try again.');
    expect(JSON.stringify(store.$state)).not.toMatch(/PRIVATE_ACTIVITY|SECRET_BEARER|\/private\/path|private-helper-error/);
  });

  test.each(['recording-control-failed', 'capture-source-unavailable', 'local-notice'])('accepts the fixed %s catalog entry', async code => {
    const copies = {
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
      'local-notice': {
        title: 'Local PeakActivity notice',
        body: 'PeakActivity has a local update. Review the dashboard for details.',
        review_source: 'home',
      },
    };
    const entry = { ...first, ...copies[code], code, delivery: 'suppressed' };
    invoke.mockResolvedValue(history([entry]));
    const store = useNotificationsStore();
    await store.refresh();
    expect(store.entries).toEqual([entry]);
  });

  test('keeps private native errors out of UI state', async () => {
    const store = useNotificationsStore();
    invoke.mockRejectedValue(new Error('/private/activity SECRET_BEARER_TOKEN'));
    await store.refresh();
    expect(store.error).toBe('Notification history could not be loaded. Refresh or clear the local history to try again.');
    expect(JSON.stringify(store.$state)).not.toContain('SECRET_BEARER_TOKEN');
    expect(store.loading).toBe(false);
  });

  test('explicit clear can remove corrupt history and acknowledges only a valid empty response', async () => {
    const store = useNotificationsStore();
    invoke.mockResolvedValueOnce({ corrupt: true }).mockResolvedValueOnce(history());
    await store.refresh();
    await store.clear();
    expect(store.entries).toEqual([]);
    expect(store.loaded).toBe(true);
    expect(store.error).toBe('');
    expect(invoke).toHaveBeenLastCalledWith('clear_notification_history');
  });

  test('a failed clear preserves history and reports only fixed safe copy', async () => {
    const store = useNotificationsStore();
    invoke.mockResolvedValueOnce(history([first])).mockRejectedValueOnce(new Error('SECRET_BEARER_TOKEN'));
    await store.refresh();
    await store.clear();
    expect(store.entries).toEqual([first]);
    expect(store.error).toBe('Notification history could not be cleared. Try again.');
    expect(store.loading).toBe(false);
  });

  test('a late read cannot restore a cleared history', async () => {
    const store = useNotificationsStore();
    const pending = deferred();
    invoke.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(history());
    const reading = store.refresh();
    await store.clear();
    pending.resolve(history([first]));
    await reading;
    expect(store.entries).toEqual([]);
    expect(store.loaded).toBe(true);
    expect(store.loading).toBe(false);
  });

  test.each(['clearSensitive', '$dispose'])('%s clears held references and invalidates a late read', async action => {
    const store = useNotificationsStore();
    invoke.mockResolvedValueOnce(history([first]));
    await store.refresh();
    const pending = deferred();
    invoke.mockReturnValueOnce(pending.promise);
    const reading = store.refresh();
    store[action]();
    expect(store.entries).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.loaded).toBe(false);
    pending.resolve(history([second]));
    await reading;
    expect(store.entries).toEqual([]);
    expect(store.error).toBe('');
  });

  test('a late failure after lock cannot restore an error', async () => {
    const store = useNotificationsStore();
    const pending = deferred();
    invoke.mockReturnValue(pending.promise);
    const reading = store.refresh();
    store.clearSensitive();
    pending.reject(new Error('private native failure'));
    await reading;
    expect(store.entries).toEqual([]);
    expect(store.error).toBe('');
    expect(store.loading).toBe(false);
  });

  test('a disposed reference cannot read again while a newly mounted store can', async () => {
    const store = useNotificationsStore();
    invoke.mockResolvedValue(history([first]));
    store.$dispose();
    await store.refresh();
    await store.clear();
    expect(invoke).not.toHaveBeenCalled();
    expect(store.entries).toEqual([]);
    const remounted = useNotificationsStore();
    await remounted.refresh();
    expect(remounted.entries).toEqual([first]);
    expect(store.entries).toEqual([]);
  });

  test('reports native unavailable without requiring online service or OS permission', async () => {
    delete (global as any).window;
    const store = useNotificationsStore();
    await store.refresh();
    expect(store.nativeAvailable).toBe(false);
    expect(store.error).toBe('Open Notifications in PeakActivity desktop.');
    expect(invoke).not.toHaveBeenCalled();
  });
});
