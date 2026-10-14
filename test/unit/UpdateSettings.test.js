import { createLocalVue, mount, shallowMount } from '@vue/test-utils';
import { BootstrapVue } from 'bootstrap-vue';
import { createPinia, setActivePinia } from 'pinia';
import UpdateSettings from '~/views/settings/UpdateSettings.vue';
import Settings from '~/views/settings/Settings.vue';
import router from '~/route';
import { useSettingsStore } from '~/stores/settings';
import { useUpdatesStore } from '~/stores/updates';

const status = state => ({ schema_version: 1, state, installed_version: '2.0.0', platform: 'macos', native_architecture: 'arm64' });
const bundle = {
  schema_version: 1, version: '1.2.3+recovery', channel: 'stable', support_status: 'limited',
  platform: 'macos', native_architecture: 'arm64', artifact_architecture: 'universal',
  source_revision: 'a'.repeat(40), manifest_fingerprint: 'B'.repeat(40), artifact_fingerprint: 'C'.repeat(40),
  local_integrity: 'verified', public_readback: 'not-checked', platform_signature: 'not-checked',
  release_freshness: 'not-checked', key_lifecycle: 'not-checked',
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const localVue = createLocalVue();
localVue.use(BootstrapVue);

describe('offline Updates panel', () => {
  let invoke, wrapper;
  const button = label => wrapper.findAll('button').wrappers.find(item => item.text() === label);
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = jest.fn().mockResolvedValue(status('ready'));
    window.__TAURI__ = { core: { invoke } };
  });
  afterEach(() => { wrapper?.destroy(); wrapper = null; delete window.__TAURI__; jest.restoreAllMocks(); });

  test('the Settings group and direct route preserve existing notification links', () => {
    jest.spyOn(useSettingsStore(), 'load').mockResolvedValue(undefined);
    wrapper = shallowMount(Settings, { localVue, propsData: { group: 'updates' } });
    expect(wrapper.vm.activeGroup).toBe('updates');
    expect(wrapper.findAll('b-nav-item-stub').wrappers.some(item => item.text() === 'Updates' && item.attributes('to') === '/settings/updates')).toBe(true);
    expect(wrapper.findComponent({ name: 'UpdateSettings' }).exists()).toBe(true);
    expect(router.match('/settings/updates').params.group).toBe('updates');
    expect(router.match('/settings/notifications').params.group).toBe('notifications');
  });

  test('a hidden panel does not invoke; activation loads status once', async () => {
    wrapper = mount(UpdateSettings, { localVue, propsData: { active: false } });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true });
    await flush();
    expect(invoke.mock.calls).toEqual([['update_integrity_status']]);
  });

  test.each(['not-configured', 'unavailable'])('shows honest %s state without a bundle action', async state => {
    invoke.mockResolvedValue(status(state));
    wrapper = mount(UpdateSettings, { localVue });
    await flush();
    expect(wrapper.text()).toContain(state === 'not-configured' ? 'Not configured' : 'Unavailable');
    expect(button('Verify local release bundle').attributes('disabled')).toBe('disabled');
    expect(wrapper.text()).not.toMatch(/update available|safe to install/i);
  });

  test('shows signed metadata and every unchecked boundary without eligibility or links', async () => {
    invoke.mockResolvedValueOnce(status('ready')).mockResolvedValueOnce(bundle);
    wrapper = mount(UpdateSettings, { localVue });
    await flush();
    await button('Verify local release bundle').trigger('click');
    await flush();
    expect(wrapper.text()).toContain('Installed version: 2.0.0');
    expect(wrapper.text()).toContain('Signed version: 1.2.3+recovery');
    expect(wrapper.text()).toContain('Artifact architecture: universal');
    expect(wrapper.text()).toContain('Native architecture: arm64');
    expect(wrapper.text()).toContain('Support: limited');
    expect(wrapper.text()).toContain(bundle.source_revision);
    expect(wrapper.text()).toContain(bundle.manifest_fingerprint);
    expect(wrapper.text()).toContain(bundle.artifact_fingerprint);
    for (const label of ['Public source and evidence readback', 'Platform signature', 'Release freshness', 'Key lifecycle']) {
      expect(wrapper.text()).toContain(`${label}: Not checked`);
    }
    expect(wrapper.findAll('a')).toHaveLength(0);
    expect(wrapper.text()).not.toMatch(/update available|safe to install|newer version|upgrade available/i);
    expect(invoke.mock.calls).toEqual([['update_integrity_status'], ['verify_update_bundle']]);
  });

  test('busy controls prevent duplicate dialogs and null cancellation clears the old result', async () => {
    let finish;
    invoke.mockResolvedValueOnce(status('ready')).mockResolvedValueOnce(bundle)
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    wrapper = mount(UpdateSettings, { localVue });
    await flush();
    await button('Verify local release bundle').trigger('click');
    await flush();
    await button('Verify local release bundle').trigger('click');
    expect(wrapper.text()).not.toContain('Signed version:');
    expect(button('Verify local release bundle').attributes('disabled')).toBe('disabled');
    expect(button('Refresh status').attributes('disabled')).toBe('disabled');
    expect(wrapper.find('[role="status"][aria-live="polite"]').text()).toContain('Checking');
    finish(null);
    await flush();
    expect(wrapper.text()).toContain('Selection cancelled');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  test('native absence and private errors are readable and never render raw output', async () => {
    delete window.__TAURI__;
    wrapper = mount(UpdateSettings, { localVue });
    await flush();
    expect(wrapper.text()).toContain('Open Updates in PeakActivity desktop.');
    expect(invoke).not.toHaveBeenCalled();
    wrapper.destroy();
    wrapper = null;
    window.__TAURI__ = { core: { invoke } };
    invoke.mockRejectedValue(new Error('/private/activity SECRET_TOKEN'));
    wrapper = mount(UpdateSettings, { localVue });
    await flush();
    expect(wrapper.find('[role="alert"]').text()).toContain('status could not be loaded');
    expect(wrapper.text()).not.toMatch(/SECRET_TOKEN|\/private\/activity/);
  });

  test('destroying a panel prevents a late result from republishing', async () => {
    let finish;
    invoke.mockResolvedValueOnce(status('ready')).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    wrapper = mount(UpdateSettings, { localVue });
    await flush();
    const store = useUpdatesStore();
    await button('Verify local release bundle').trigger('click');
    wrapper.destroy();
    wrapper = null;
    finish(bundle);
    await flush();
    expect(store.result).toBeNull();
    expect(store.error).toBe('');
    expect(store.loading).toBe(false);
  });
});
