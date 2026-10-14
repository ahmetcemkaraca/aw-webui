import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Privacy from '~/views/settings/PrivacyFilterSettings.vue';
import Pattern from '~/views/settings/ActivePatternSettings.vue';
import Retention from '~/views/settings/DataRetentionSettings.vue';
import { useSettingsStore } from '~/stores/settings';
import { clearPolicyDrafts, hasPolicyDrafts, reloadPolicyDrafts } from '~/util/policyDrafts';
import { applyPolicyChoice } from '~/util/policyApply';
const mockSettings = jest.fn();
jest.mock('~/util/awclient', () => ({ getClient: () => ({ get_settings: mockSettings }) }));
let wrappers = [];
beforeEach(() => {
  setActivePinia(createPinia());
  clearPolicyDrafts();
  useSettingsStore()._loaded = true;
  mockSettings.mockReset();
  jest.spyOn(useSettingsStore(), 'ensureLoaded').mockResolvedValue(undefined);
});
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.destroy());
  wrappers = [];
  clearPolicyDrafts();
  jest.restoreAllMocks();
});
const mount = Component => {
  const wrapper = shallowMount(Component);
  wrappers.push(wrapper);
  return wrapper;
};
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
test('hidden privacy filter edits and pending saves block reload then unregister on destruction', async () => {
  const wrapper = mount(Privacy);
  await flush();
  expect(hasPolicyDrafts()).toBe(false);
  await wrapper.setData({ editorText: '[] ' });
  expect(hasPolicyDrafts()).toBe(true);
  expect(await reloadPolicyDrafts('settings.privacy_filters', async () => true)).toBe(false);
  wrapper.vm.resetEditor();
  await flush();
  useSettingsStore().privacy_filters = [
    { enabled: true, field: 'app', pattern: 'Editor', action: 'drop' },
  ];
  expect(await reloadPolicyDrafts('settings.privacy_filters', async () => true)).toBe(true);
  expect(wrapper.vm.editorText).toContain('Editor');
  wrapper.destroy();
  expect(hasPolicyDrafts()).toBe(false);
});
test('invalid active-pattern draft survives native patch and clean reload does not autosave', async () => {
  const update = jest.spyOn(useSettingsStore(), 'update').mockResolvedValue(undefined);
  const wrapper = mount(Pattern);
  await flush();
  await wrapper.setData({ always_active_pattern_editing: '[' });
  expect(hasPolicyDrafts()).toBe(true);
  useSettingsStore().always_active_pattern = 'Remote';
  expect(await reloadPolicyDrafts('settings.always_active_pattern', async () => true)).toBe(false);
  expect(wrapper.vm.always_active_pattern_editing).toBe('[');
  await wrapper.setData({ always_active_pattern_editing: wrapper.vm.savedPattern });
  update.mockClear();
  expect(await reloadPolicyDrafts('settings.always_active_pattern', async () => true)).toBe(true);
  await flush();
  expect(wrapper.vm.always_active_pattern_editing).toBe('Remote');
  expect(update).not.toHaveBeenCalled();
});
test('retention displays an accepted nonpreset value and blocks an unacknowledged local selection', async () => {
  const wrapper = mount(Retention);
  await flush();
  const update = jest.spyOn(useSettingsStore(), 'update').mockResolvedValue(undefined);
  useSettingsStore().rawRetentionDays = 17;
  expect(await reloadPolicyDrafts('settings.rawRetentionDays', async () => true)).toBe(true);
  await flush();
  expect(wrapper.vm.selectedDays).toBe(17);
  expect(wrapper.vm.displayOptions.some(option => option.value === 17)).toBe(true);
  expect(update).not.toHaveBeenCalled();
  await wrapper.setData({ selectedDays: 23 });
  expect(hasPolicyDrafts()).toBe(true);
});

test.each([
  [Privacy, 'settings.privacy_filters', {privacy_filters:[{enabled:true,field:'app',pattern:'Remote',action:'drop'}]}, vm => vm.editorText.includes('Remote')],
  [Pattern, 'settings.always_active_pattern', {always_active_pattern:'Remote'}, vm => vm.always_active_pattern_editing === 'Remote'],
  [Retention, 'settings.rawRetentionDays', {rawRetentionDays:17}, vm => vm.selectedDays === 17],
])('authoritative accepted value reaches the real clean editor without autosave', async (component, field, native, updated) => {
  const wrapper = mount(component); await flush();
  const update = jest.spyOn(useSettingsStore(), 'update').mockResolvedValue(undefined);
  mockSettings.mockResolvedValue(native);
  expect(await applyPolicyChoice({schema_version:1,field,decision:'accept-remote',applied:true},async()=>true)).toBe(true);
  await flush(); expect(updated(wrapper.vm)).toBe(true); expect(update).not.toHaveBeenCalled();
});
