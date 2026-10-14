import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from '~/stores/settings';
import { useCategoryStore } from '~/stores/categories';
import { useViewsStore } from '~/stores/views';
import { useCaptureStore } from '~/stores/capture';
import { applyPolicyChoice, policyBlocked } from '~/util/policyApply';
import { clearPolicyDrafts, registerPolicyDraft } from '~/util/policyDrafts';
const getSettings = jest.fn(),
  get = jest.fn();
jest.mock('~/util/awclient', () => ({
  getClient: () => ({ get_settings: getSettings, req: { get } }),
}));
beforeEach(() => {
  setActivePinia(createPinia());
  clearPolicyDrafts();
  getSettings.mockReset();
  useSettingsStore()._loaded = true;
});
afterEach(() => {
  clearPolicyDrafts();
  jest.restoreAllMocks();
});
const ack = (field: any = 'settings.theme') => ({
  schema_version: 1 as const,
  field,
  decision: 'accept-remote' as const,
  applied: true,
});
test('applies acknowledged settings through native snapshot and derives companion stores once', async () => {
  getSettings.mockResolvedValue({
    category_sets: [{ id: 'Remote', categories: [] }],
    active_set_ids: ['Remote'],
  });
  const categories = useCategoryStore();
  const load = jest.spyOn(categories, 'load');
  expect(await applyPolicyChoice(ack('settings.classes'), async () => true)).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
  expect(categories.category_sets[0].id).toBe('Remote');
  expect(categories.hasPolicyDraft).toBe(false);
});
test('store drafts remain guarded even after editor unregister and do not fetch native settings', async () => {
  const views = useViewsStore();
  views.loadViews([{ id: 'view', name: 'Saved', elements: [] }]);
  views.views[0].name = 'Draft';
  expect(policyBlocked()).toBe(true);
  expect(await applyPolicyChoice(ack(), async () => true)).toBe(false);
  expect(getSettings).not.toHaveBeenCalled();
});
test('lost lifetime during snapshot fetch preserves fields and does not run clean callbacks', async () => {
  const settings = useSettingsStore();
  settings.theme = 'dark';
  let finish!: (value: any) => void;
  getSettings.mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    })
  );
  const reload = jest.fn();
  registerPolicyDraft(['settings.theme'], { blocked: () => false, reload });
  let current = true;
  const applying = applyPolicyChoice(ack(), async () => current);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  current = false;
  finish({ theme: 'light' });
  expect(await applying).toBe(false);
  expect(settings.theme).toBe('dark');
  expect(reload).not.toHaveBeenCalled();
});
test('failed owned component refresh keeps the acknowledged reload pending', async () => {
  registerPolicyDraft(['egress.user_policy'], {
    blocked: () => false,
    reload: async () => {
      throw new Error('synthetic refresh failure');
    },
  });
  expect(await applyPolicyChoice(ack('egress.user_policy'), async () => true)).toBe(false);
});
test('keep-local acknowledgement performs no reload or writes', async () => {
  expect(
    await applyPolicyChoice({ ...ack(), decision: 'keep-local', applied: false }, async () => true)
  ).toBe(true);
  expect(getSettings).not.toHaveBeenCalled();
});
test('capture acknowledgement refreshes the shared store when no capture editor is mounted', async () => {
  get.mockResolvedValue({ data: { policy: { titles: false }, recording: false } });
  expect(await applyPolicyChoice(ack('capture.minimization'), async () => true)).toBe(true);
  expect(useCaptureStore().policy?.titles).toBe(false);
  expect(get).toHaveBeenCalledWith('/0/capture/');
});
