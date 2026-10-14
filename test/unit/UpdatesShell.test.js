import { createLocalVue, mount, shallowMount } from '@vue/test-utils';
import { BootstrapVue } from 'bootstrap-vue';
import VueRouter from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import App from '~/App.vue';
import Settings from '~/views/settings/Settings.vue';
import router from '~/route';
import { useSettingsStore } from '~/stores/settings';
import { useVaultStore } from '~/stores/vault';
import { useServerStore } from '~/stores/server';
import * as decryptedState from '~/stores/clearDecryptedState';
import { getClient, clearLocalSession } from '~/util/awclient';

jest.mock('~/util/awclient', () => ({
  getClient: jest.fn(() => { throw new Error('Unexpected local API request'); }),
  clearLocalSession: jest.fn(),
}));

const localVue = createLocalVue();
localVue.use(BootstrapVue);
localVue.use(VueRouter);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const nativeStatus = { schema_version: 1, state: 'not-configured', installed_version: '0.1.0', platform: 'linux', native_architecture: 'x86_64' };
const stubs = {
  'aw-header': { template: '<div>DECRYPTED_HEADER</div>' },
  'aw-footer': true, CaptureControls: true,
  Onboarding: { template: '<div>DECRYPTED_SETUP</div>' },
  'router-view': { template: '<div>DECRYPTED_VIEW</div>' },
  'error-boundary': { template: '<div><slot /></div>' },
};

describe('Updates access without a ready vault', () => {
  let wrapper, invoke, shellRouter;
  beforeEach(() => {
    setActivePinia(createPinia());
    jest.clearAllMocks();
    localStorage.clear();
    shellRouter = new VueRouter({ routes: [{ path: '/home' }, { path: '/settings/updates' }] });
    invoke = jest.fn().mockResolvedValue(nativeStatus);
    window.__TAURI__ = { core: { invoke } };
  });
  afterEach(() => { wrapper?.destroy(); wrapper = null; delete window.__TAURI__; jest.restoreAllMocks(); });

  test('Settings exposes Updates and permits its direct route', () => {
    jest.spyOn(useSettingsStore(), 'load').mockResolvedValue(undefined);
    wrapper = shallowMount(Settings, { localVue, propsData: { group: 'updates' } });
    expect(wrapper.vm.activeGroup).toBe('updates');
    expect(router.match('/settings/updates').params.group).toBe('updates');
  });

  test.each([
    ['fresh', { state: 'locked', has_vault: false, generation: 0, message: null }],
    ['locked', { state: 'locked', has_vault: true, generation: 1, message: null }],
    ['failed', { state: 'failed', has_vault: true, generation: 1, message: 'Vault unavailable' }],
    ['pre-setup', { state: 'ready', has_vault: true, generation: 1, message: null }],
  ])('direct %s shell mounts the real panel without initialization or decrypted views', async (_name, vault) => {
    useVaultStore().status = vault;
    localStorage.setItem('peakactivity.setup', 'pending');
    await shellRouter.push('/settings/updates');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    expect(wrapper.find('[aria-labelledby="update-integrity-title"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Not configured');
    expect(wrapper.text()).not.toMatch(/DECRYPTED_/);
    expect(invoke.mock.calls).toEqual([['update_integrity_status']]);
    expect(getClient).not.toHaveBeenCalled();
    expect(clearLocalSession).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Back to local app"]').exists()).toBe(true);
    await wrapper.vm.checkVaultState();
    await wrapper.vm.initialize();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(getClient).not.toHaveBeenCalled();
  });

  test('the explicit Updates action works while startup is pending and Back restores the locked shell', async () => {
    let finishStartup;
    const locked = { state: 'locked', has_vault: true, generation: 1, message: null };
    invoke.mockImplementation(command => command === 'vault_status'
      ? new Promise(resolve => { finishStartup = resolve; }) : Promise.resolve(nativeStatus));
    await shellRouter.push('/home');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    const open = wrapper.find('[aria-label="Open Updates without unlocking the vault"]');
    expect(open.exists()).toBe(true);
    await open.trigger('click');
    finishStartup(locked);
    await flush();
    expect(wrapper.find('[aria-labelledby="update-integrity-title"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/DECRYPTED_/);
    expect(getClient).not.toHaveBeenCalled();
    invoke.mockImplementation(command => Promise.resolve(command === 'vault_status' ? locked : nativeStatus));
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    await flush();
    expect(wrapper.find('[aria-labelledby="update-integrity-title"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Unlock vault');
    expect(getClient).not.toHaveBeenCalled();
  });

  test('the error shell keeps the same explicit native-only entry', async () => {
    const locked = { state: 'locked', has_vault: true, generation: 1, message: null };
    invoke.mockImplementation(command => Promise.resolve(command === 'vault_status' ? locked : nativeStatus));
    await shellRouter.push('/home');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    await wrapper.setData({ loadError: 'Setup is unavailable' });
    const open = wrapper.find('[aria-label="Open Updates without unlocking the vault"]');
    expect(open.exists()).toBe(true);
    await open.trigger('click');
    await flush();
    expect(wrapper.find('[aria-labelledby="update-integrity-title"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/DECRYPTED_|Setup is unavailable/);
    expect(getClient).not.toHaveBeenCalled();
  });

  test.each(['settings', 'server-info'])('entering Updates during pending %s stops startup continuation', async phase => {
    const ready = { state: 'ready', has_vault: true, generation: 1, message: null };
    invoke.mockImplementation(command => Promise.resolve(command === 'vault_status' ? ready : nativeStatus));
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const settings = jest.spyOn(useSettingsStore(), 'ensureLoaded').mockImplementation(() => phase === 'settings' ? pending : Promise.resolve());
    const info = jest.spyOn(useServerStore(), 'getInfo').mockImplementation(() => phase === 'server-info' ? pending : Promise.resolve());
    localStorage.setItem('peakactivity.setup', 'pending');
    await shellRouter.push('/home');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    expect(settings).toHaveBeenCalledTimes(1);
    if (phase === 'server-info') expect(info).toHaveBeenCalledTimes(1);
    await wrapper.find('[aria-label="Open Updates without unlocking the vault"]').trigger('click');
    await flush();
    finish();
    await flush();
    if (phase === 'settings') expect(info).not.toHaveBeenCalled();
    expect(wrapper.vm.loaded).toBe(false);
    expect(wrapper.find('[aria-labelledby="update-integrity-title"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/DECRYPTED_/);
    expect(getClient).not.toHaveBeenCalled();
  });

  test('Back hides previously loaded views until fresh native vault status confirms readiness', async () => {
    const ready = { state: 'ready', has_vault: true, generation: 1, message: null };
    const locked = { ...ready, state: 'locked', generation: 2 };
    const vault = useVaultStore();
    const recoveryCode = 'f'.repeat(64);
    vault.status = ready;
    vault.recoveryCode = recoveryCode;
    const clear = jest.spyOn(decryptedState, 'clearDecryptedState');
    await shellRouter.push('/settings/updates');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    await wrapper.setData({ loaded: true, setupComplete: true, recoveryCode });
    let finish;
    invoke.mockImplementation(command => command === 'vault_status'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(nativeStatus));
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    try { expect(wrapper.text()).not.toMatch(/DECRYPTED_/); }
    finally { finish(locked); await flush(); }
    expect(wrapper.text()).toContain('Unlock vault');
    expect(wrapper.text()).not.toMatch(/DECRYPTED_/);
    expect(wrapper.text()).not.toContain(recoveryCode);
    expect(vault.recoveryCode).toBe('');
    expect(wrapper.vm.recoveryCode).toBe('');
    expect(clear).toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  test.each(['resolve', 'reject'])('older settings cannot %s over Back’s pending vault readiness check', async outcome => {
    const ready = { state: 'ready', has_vault: true, generation: 1, message: null };
    const locked = { ...ready, state: 'locked', generation: 2 };
    let finishVault, finishSettings, failSettings, vaultReads = 0;
    const freshVault = new Promise(resolve => { finishVault = resolve; });
    const olderSettings = new Promise((resolve, reject) => { finishSettings = resolve; failSettings = reject; });
    invoke.mockImplementation(command => command === 'vault_status'
      ? (++vaultReads === 1 ? Promise.resolve(ready) : freshVault) : Promise.resolve(nativeStatus));
    jest.spyOn(useSettingsStore(), 'ensureLoaded').mockReturnValue(olderSettings);
    const info = jest.spyOn(useServerStore(), 'getInfo').mockResolvedValue(undefined);
    localStorage.setItem('peakactivity.setup', 'complete');
    await shellRouter.push('/home');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    await wrapper.find('[aria-label="Open Updates without unlocking the vault"]').trigger('click');
    await flush();
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    await flush();
    expect(vaultReads).toBe(2);
    if (outcome === 'resolve') finishSettings();
    else failSettings(new Error('PRIVATE_OLD_SETTINGS_ERROR'));
    await flush();
    try {
      expect(info).not.toHaveBeenCalled();
      expect(wrapper.vm.loaded).toBe(false);
      expect(wrapper.vm.loadError).toBe('');
      expect(wrapper.text()).not.toMatch(/DECRYPTED_|PRIVATE_OLD_SETTINGS_ERROR/);
    } finally { finishVault(locked); await flush(); }
    expect(wrapper.text()).toContain('Unlock vault');
    expect(getClient).not.toHaveBeenCalled();
  });

  test('Back cannot trust cached ready status after its native readiness check fails', async () => {
    const vault = useVaultStore();
    const recoveryCode = 'f'.repeat(64);
    vault.status = { state: 'ready', has_vault: true, generation: 1, message: null };
    vault.recoveryCode = recoveryCode;
    localStorage.setItem('peakactivity.setup', 'complete');
    await shellRouter.push('/settings/updates');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    await wrapper.setData({ loaded: true, setupComplete: true, recoveryCode });
    const settings = jest.spyOn(useSettingsStore(), 'ensureLoaded').mockResolvedValue(undefined);
    const info = jest.spyOn(useServerStore(), 'getInfo').mockResolvedValue(undefined);
    const clear = jest.spyOn(decryptedState, 'clearDecryptedState');
    let rejectStatus;
    invoke.mockImplementation(command => command === 'vault_status'
      ? new Promise((_resolve, reject) => { rejectStatus = reject; }) : Promise.resolve(nativeStatus));
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    expect(wrapper.text()).not.toMatch(/DECRYPTED_/);
    rejectStatus(new Error('/private/activity PRIVATE_NATIVE_STATUS_ERROR'));
    await flush();
    expect(settings).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
    expect(vault.isReady).toBe(false);
    expect(vault.recoveryCode).toBe('');
    expect(wrapper.vm.recoveryCode).toBe('');
    expect(wrapper.vm.loaded).toBe(false);
    expect(wrapper.text()).not.toMatch(/DECRYPTED_|PRIVATE_NATIVE_STATUS_ERROR|\/private\/activity/);
    expect(wrapper.text()).not.toContain(recoveryCode);
    expect(wrapper.find('main[role="alert"]').text()).toContain('The local vault status could not be confirmed. Try again or open Updates.');
    expect(clear).toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Open Updates without unlocking the vault"]').exists()).toBe(true);
  });

  test('Back resumes normal loading after a successful native ready response clears an older error', async () => {
    const vault = useVaultStore();
    const ready = { state: 'ready', has_vault: true, generation: 2, message: null };
    vault.status = { ...ready, generation: 1 };
    vault.error = 'An older local operation failed';
    localStorage.setItem('peakactivity.setup', 'complete');
    await shellRouter.push('/settings/updates');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    const settings = useSettingsStore();
    settings.theme = 'light';
    const load = jest.spyOn(settings, 'ensureLoaded').mockResolvedValue(undefined);
    const info = jest.spyOn(useServerStore(), 'getInfo').mockResolvedValue(undefined);
    invoke.mockImplementation(command => Promise.resolve(command === 'vault_status' ? ready : nativeStatus));
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    await flush();
    expect(vault.error).toBe('');
    expect(vault.isReady).toBe(true);
    expect(wrapper.vm.loaded).toBe(true);
    expect(wrapper.vm.loadError).toBe('');
    expect(load).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
  });

  test('Back clears retained recovery codes while the native vault is still opening', async () => {
    const vault = useVaultStore();
    const recoveryCode = 'f'.repeat(64);
    vault.status = { state: 'ready', has_vault: true, generation: 1, message: null };
    vault.recoveryCode = recoveryCode;
    await shellRouter.push('/settings/updates');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await flush();
    await wrapper.setData({ recoveryCode });
    const opening = { state: 'opening', has_vault: true, generation: 2, message: null };
    invoke.mockImplementation(command => Promise.resolve(command === 'vault_status' ? opening : nativeStatus));
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    await flush();
    expect(wrapper.text()).toContain('Checking the local vault');
    expect(wrapper.text()).not.toContain(recoveryCode);
    expect(wrapper.text()).not.toMatch(/DECRYPTED_/);
    expect(vault.recoveryCode).toBe('');
    expect(wrapper.vm.recoveryCode).toBe('');
    expect(wrapper.vm.pollTimer).not.toBeNull();
    expect(getClient).not.toHaveBeenCalled();
  });

  test('Back uses its own failed status result when an older ready response clears the shared error in the same tick', async () => {
    const vault = useVaultStore();
    const recoveryCode = 'f'.repeat(64);
    vault.recoveryCode = recoveryCode;
    let resolveOlder, rejectFresh, reads = 0;
    const older = new Promise(resolve => { resolveOlder = resolve; });
    const fresh = new Promise((_resolve, reject) => { rejectFresh = reject; });
    invoke.mockImplementation(command => command === 'vault_status'
      ? (++reads === 1 ? older : fresh) : Promise.resolve(nativeStatus));
    const settings = jest.spyOn(useSettingsStore(), 'ensureLoaded').mockResolvedValue(undefined);
    const info = jest.spyOn(useServerStore(), 'getInfo').mockResolvedValue(undefined);
    localStorage.setItem('peakactivity.setup', 'complete');
    await shellRouter.push('/home');
    wrapper = mount(App, { localVue, router: shellRouter, stubs });
    await wrapper.setData({ recoveryCode });
    await wrapper.find('[aria-label="Open Updates without unlocking the vault"]').trigger('click');
    await flush();
    await wrapper.find('[aria-label="Back to local app"]').trigger('click');
    expect(reads).toBe(2);
    rejectFresh(new Error('PRIVATE_FRESH_NATIVE_ERROR'));
    resolveOlder({ state: 'ready', has_vault: true, generation: 1, message: null });
    await flush();
    expect(settings).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
    expect(wrapper.vm.loaded).toBe(false);
    expect(wrapper.find('main[role="alert"]').text()).toContain('The local vault status could not be confirmed. Try again or open Updates.');
    expect(wrapper.text()).not.toMatch(/DECRYPTED_|PRIVATE_FRESH_NATIVE_ERROR/);
    expect(wrapper.text()).not.toContain(recoveryCode);
    expect(vault.recoveryCode).toBe('');
    expect(wrapper.vm.recoveryCode).toBe('');
  });
});
