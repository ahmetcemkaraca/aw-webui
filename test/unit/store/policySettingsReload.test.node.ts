import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from '~/stores/settings';
const getSettings = jest.fn(),
  post = jest.fn();
jest.mock('~/util/awclient', () => ({
  getClient: () => ({ get_settings: getSettings, req: { post, defaults: {} } }),
}));
const storage: Record<string, string> = {};
beforeEach(() => {
  setActivePinia(createPinia());
  getSettings.mockReset();
  post.mockReset();
  for (const key of Object.keys(storage)) delete storage[key];
  (global as any).localStorage = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: any) => {
      storage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
  };
  useSettingsStore()._loaded = true;
});
afterEach(() => delete (global as any).localStorage);
const deferred = () => {
  let resolve!: (v: any) => void, reject!: (v: any) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test('authoritative deletion restores only accepted defaults and removes obsolete legacy fallback', async () => {
  const settings = useSettingsStore();
  settings.theme = 'dark';
  settings.saved_queries = [{ id: 'draft', name: 'draft', query_code: '' } as any];
  storage.theme = 'dark';
  storage.unrelated = 'keep';
  getSettings.mockResolvedValue({});
  const update = jest.spyOn(settings, 'update');
  const save = jest.spyOn(settings, 'save');
  expect(await settings.reloadPolicy('settings.theme', async () => true)).toBe(true);
  expect(settings.theme).toBe('auto');
  expect(settings.saved_queries[0].id).toBe('draft');
  expect(storage.theme).not.toBe('dark');
  expect(storage.unrelated).toBe('keep');
  expect(update).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
test('keeps stored null empty false and zero values distinct from missing keys', async () => {
  const settings = useSettingsStore();
  for (const [field, key, value] of [
    ['settings.classes', 'classes', null],
    ['settings.views', 'views', []],
    ['settings.useColorFallback', 'useColorFallback', false],
    ['settings.rawRetentionDays', 'rawRetentionDays', 0],
  ] as const) {
    getSettings.mockResolvedValue({ [key]: value });
    expect(await settings.reloadPolicy(field, async () => true)).toBe(true);
    expect((settings as any)[key]).toEqual(value);
  }
  expect(storage.useColorFallback).toBe('false');
});
test('reloads category companions together from one native snapshot and clones inputs/defaults', async () => {
  const settings = useSettingsStore();
  const sets = [{ id: 'Remote', categories: [] }];
  getSettings.mockResolvedValue({ category_sets: sets, active_set_ids: ['Remote'] });
  expect(await settings.reloadPolicy('settings.classes', async () => true)).toBe(true);
  expect(getSettings).toHaveBeenCalledTimes(1);
  expect(settings.category_sets).toEqual(sets);
  expect(settings.active_set_ids).toEqual(['Remote']);
  expect(settings.category_sets).not.toBe(sets);
  settings.classes[0].name.push('changed clone');
  getSettings.mockResolvedValue({});
  await settings.reloadPolicy('settings.classes', async () => true);
  expect(settings.classes[0].name).not.toContain('changed clone');
});
test('late or failed ownership never patches state or legacy caches', async () => {
  const settings = useSettingsStore();
  settings.theme = 'dark';
  storage.theme = 'dark';
  const pending = deferred();
  getSettings.mockReturnValueOnce(pending.promise);
  let current = true;
  const loading = settings.reloadPolicy('settings.theme', async () => current);
  await Promise.resolve();
  await Promise.resolve();
  current = false;
  pending.resolve({ theme: 'light' });
  expect(await loading).toBe(false);
  expect(settings.theme).toBe('dark');
  expect(storage.theme).toBe('dark');
});
test('tracks update before its first await and preserves the guard through actual persistence', async () => {
  const settings = useSettingsStore();
  const loading = deferred(),
    saving = deferred();
  jest.spyOn(settings, 'ensureLoaded').mockReturnValue(loading.promise);
  jest.spyOn(settings, 'save').mockReturnValue(saving.promise);
  const update = settings.update({ theme: 'light' });
  expect(settings._pendingPolicyWrites).toBeGreaterThan(0);
  loading.resolve(undefined);
  await Promise.resolve();
  await Promise.resolve();
  expect(settings._pendingPolicyWrites).toBeGreaterThan(0);
  saving.resolve(undefined);
  await update;
  expect(settings._pendingPolicyWrites).toBe(0);
});
test('pending writes block reload before and after snapshot fetch and release after failures', async () => {
  const settings = useSettingsStore();
  const saving = deferred();
  getSettings.mockReturnValueOnce(saving.promise);
  const save = settings.save();
  expect(settings._pendingPolicyWrites).toBeGreaterThan(0);
  expect(await settings.reloadPolicy('settings.theme', async () => true)).toBe(false);
  saving.reject(new Error('synthetic read failure'));
  await expect(save).rejects.toThrow();
  expect(settings._pendingPolicyWrites).toBe(0);
});
