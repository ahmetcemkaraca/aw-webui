import { createLocalVue, shallowMount } from '@vue/test-utils';
import { BootstrapVue } from 'bootstrap-vue';
import { createPinia, setActivePinia } from 'pinia';
import SyncSettings from '~/views/settings/SyncSettings.vue';
import Settings from '~/views/settings/Settings.vue';
import { useSyncStore } from '~/stores/sync';
import { useSettingsStore } from '~/stores/settings';
const localVue = createLocalVue();
localVue.use(BootstrapVue);
let wrapper;
beforeEach(() => {
  setActivePinia(createPinia());
  jest.spyOn(useSettingsStore(), 'load').mockResolvedValue(undefined);
  const sync = useSyncStore();
  for (const action of [
    'refresh',
    'refreshAccessHistory',
    'refreshTombstoneStatuses',
    'refreshRecoveryConfirmation',
    'refreshSyncControl',
    'cancelPairing',
    'cancelRecoveryKit',
  ])
    jest.spyOn(sync, action).mockResolvedValue(undefined);
});
afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  jest.restoreAllMocks();
});
test('the real Settings navigation passes active only for the selected sync group', async () => {
  wrapper = shallowMount(Settings, { localVue, propsData: { group: 'general' } });
  const sync = wrapper.findComponent({ name: 'SyncSettings' });
  expect(sync.props('active')).toBe(false);
  await wrapper.setProps({ group: 'sync' });
  expect(sync.props('active')).toBe(true);
});
test('the real sync screen mounts the review and forwards visibility without starting relay sync', async () => {
  const sync = useSyncStore();
  const start = jest.spyOn(sync, 'setSyncEnabled');
  wrapper = shallowMount(SyncSettings, { localVue, propsData: { active: false } });
  const review = wrapper.findComponent({ name: 'SyncPolicyReview' });
  expect(review.exists()).toBe(true);
  expect(review.props('active')).toBe(false);
  await wrapper.setProps({ active: true });
  expect(review.props('active')).toBe(true);
  expect(start).not.toHaveBeenCalled();
});
test('recovery preview announces retained pending policies and legacy absence', async () => {
  const sync = useSyncStore();
  sync.restorePreview = { policy_conflict_count: 2, policy_continuity_present: true };
  wrapper = shallowMount(SyncSettings, { localVue });
  expect(wrapper.text()).toContain('2 settings or policy fields need local review');
  expect(wrapper.text()).toContain('Current settings stay active');
  sync.restorePreview = { ...sync.restorePreview, policy_continuity_present: false };
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain('Portable active settings are absent from this legacy snapshot');
});
test('selected restore exposes the existing explicit saved-kit confirmation step', async () => {
  const { useBackupStore } = await import('~/stores/backups');
  const sync = useSyncStore();
  sync.recoveryConfirmed = true;
  wrapper = shallowMount(SyncSettings, { localVue });
  useBackupStore().restored = true;
  await wrapper.vm.$nextTick();
  expect(sync.recoveryRestored).toBe(true);
  expect(sync.recoveryConfirmed).toBe(false);
  expect(wrapper.text()).toContain('I saved the recovery phrase and encrypted kit.');
});
