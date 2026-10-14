import { createLocalVue, mount, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { BootstrapVue } from 'bootstrap-vue';
import Settings from '~/views/settings/Settings.vue';
import router from '~/route';
import { useSettingsStore } from '~/stores/settings';
import { useVaultStore } from '~/stores/vault';
import { useNotificationsStore } from '~/stores/notifications';
import NotificationSettings from '~/views/settings/NotificationSettings.vue';

describe('notification settings integration', () => {
  const localVue = createLocalVue();
  localVue.use(BootstrapVue);

  beforeEach(() => {
    setActivePinia(createPinia());
    jest.spyOn(useSettingsStore(), 'load').mockResolvedValue(undefined);
  });

  test('opens a discoverable Notifications group from the settings route prop', () => {
    const wrapper = shallowMount(Settings, { localVue, propsData: { group: 'notifications' } });
    expect(wrapper.vm.activeGroup).toBe('notifications');
    expect(wrapper.findAll('b-nav-item-stub').wrappers.some(item =>
      item.text() === 'Notifications' && item.attributes('to') === '/settings/notifications'
    )).toBe(true);
    expect(wrapper.findComponent({ name: 'NotificationSettings' }).exists()).toBe(true);
    wrapper.destroy();
  });

  test('accepts direct notification settings links', () => {
    const match = router.match('/settings/notifications');
    expect(match.params.group).toBe('notifications');
    expect(match.matched.some(route => route.path.includes(':group('))).toBe(true);
  });
});

describe('local notification history panel', () => {
  const localVue = createLocalVue();
  localVue.use(BootstrapVue);
  const entry = {
    id: 'AQEBAQEBAQEBAQEBAQEBAQ', created_at: '2026-10-13T09:00:00Z',
    code: 'recording-control-failed', delivery: 'attempted',
    title: 'Recording control needs attention',
    body: 'PeakActivity could not change recording. Review your privacy settings.',
    review_source: 'privacy',
  };
  const history = entries => ({ schema_version: 1, limit: 200, permission: 'unknown', entries });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  let invoke;
  let wrapper;
  const button = label => wrapper.findAll('button').wrappers.find(item => item.text() === label);

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = jest.fn().mockResolvedValue(history([]));
    window.__TAURI__ = { core: { invoke } };
    useVaultStore().status = { state: 'ready', message: null, has_vault: true, generation: 1 };
  });
  afterEach(() => {
    wrapper?.destroy();
    wrapper = null;
    delete window.__TAURI__;
    jest.restoreAllMocks();
  });

  test('does not load a hidden settings panel; opening it loads once', async () => {
    wrapper = mount(NotificationSettings, { localVue, router, propsData: { active: false } });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('notification_history');
  });

  test('announces loading and empty history with honest permission and delivery copy', async () => {
    let resolve;
    invoke.mockReturnValue(new Promise(yes => { resolve = yes; }));
    wrapper = mount(NotificationSettings, { localVue, router });
    expect(wrapper.find('[role="status"][aria-live="polite"]').text()).toContain('Loading notification history');
    expect(button('Refresh').attributes('disabled')).toBe('disabled');
    resolve(history([]));
    await flush();
    expect(wrapper.text()).toContain('Permission: Unknown');
    expect(wrapper.text()).toContain('An attempted delivery does not confirm OS display or permission.');
    expect(wrapper.find('[role="status"]').text()).toContain('No local notifications recorded');
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
  });

  test('renders newest entries and offers fixed local review and help links', async () => {
    const newer = {
      ...entry, id: 'AgICAgICAgICAgICAgICAg', created_at: '2026-10-13T09:01:00Z',
      code: 'local-notice', delivery: 'suppressed', title: 'Local PeakActivity notice',
      body: 'PeakActivity has a local update. Review the dashboard for details.', review_source: 'home',
    };
    invoke.mockResolvedValue(history([entry, newer]));
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    expect(wrapper.findAll('li').at(0).text()).toContain('Local PeakActivity notice');
    const reviewLinks = wrapper.findAll('a').wrappers.filter(item => item.text() === 'Review source');
    expect(reviewLinks.map(item => item.attributes('href'))).toEqual(['#/home', '#/settings/privacy']);
    expect(wrapper.findAll('a').wrappers.find(item => item.text() === 'Get help').attributes('href')).toBe('#/about');
    expect(wrapper.findAll('a[href^="http"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('Attempted');
    expect(wrapper.text()).toContain('Suppressed');
    expect(wrapper.find('time').attributes('datetime')).toBe(newer.created_at);
  });

  test('refresh is explicit and clear requires confirmation without an access gate', async () => {
    invoke.mockResolvedValue(history([entry]));
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await button('Clear history').trigger('click');
    expect(useNotificationsStore().entries).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    invoke.mockResolvedValue(history([]));
    await button('Clear history').trigger('click');
    await flush();
    expect(useNotificationsStore().entries).toEqual([]);
    expect(invoke).toHaveBeenLastCalledWith('clear_notification_history');
    await button('Refresh').trigger('click');
    await flush();
    expect(invoke).toHaveBeenLastCalledWith('notification_history');
    expect(wrapper.text()).not.toMatch(/premium|sign in|subscription|entitlement/i);
  });

  test('shows safe errors and retains a usable clear action for corrupt history', async () => {
    invoke.mockRejectedValue(new Error('PRIVATE_ACTIVITY_TITLE /private/path SECRET_BEARER_TOKEN'));
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    expect(wrapper.find('[role="alert"]').text()).toContain('Notification history could not be loaded');
    expect(wrapper.text()).not.toMatch(/PRIVATE_ACTIVITY_TITLE|\/private\/path|SECRET_BEARER_TOKEN/);
    expect(button('Clear history').attributes('disabled')).toBeUndefined();
  });

  test('switching panels during clear preserves its acknowledged empty result', async () => {
    let acknowledge;
    invoke.mockResolvedValueOnce(history([entry]))
      .mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve; }))
      .mockResolvedValue(history([entry]));
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    await button('Clear history').trigger('click');
    await wrapper.setProps({ active: false });
    await wrapper.setProps({ active: true });
    acknowledge(history([]));
    await flush();
    expect(useNotificationsStore().entries).toEqual([]);
    expect(useNotificationsStore().loading).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test('lock immediately hides cached history and ignores a pending read', async () => {
    invoke.mockResolvedValue(history([entry]));
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    let resolve;
    invoke.mockReturnValue(new Promise(yes => { resolve = yes; }));
    await button('Refresh').trigger('click');
    useVaultStore().status = { state: 'locked', message: null, has_vault: true, generation: 2 };
    await flush();
    expect(wrapper.text()).toContain('Unlock the local vault to view notification history.');
    expect(wrapper.text()).not.toContain(entry.title);
    expect(useNotificationsStore().entries).toEqual([]);
    resolve(history([entry]));
    await flush();
    expect(useNotificationsStore().entries).toEqual([]);
    expect(button('Refresh').attributes('disabled')).toBe('disabled');
  });

  test('locked and native unavailable states do not invoke history or permission commands', async () => {
    useVaultStore().status = { state: 'locked', message: null, has_vault: true, generation: 2 };
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    expect(wrapper.text()).toContain('Unlock the local vault');
    expect(invoke).not.toHaveBeenCalled();
    wrapper.destroy();
    wrapper = null;
    delete window.__TAURI__;
    useVaultStore().status = { state: 'ready', message: null, has_vault: true, generation: 3 };
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    expect(wrapper.text()).toContain('Open Notifications in PeakActivity desktop.');
    expect(invoke).not.toHaveBeenCalled();
    expect(button('Clear history').attributes('disabled')).toBe('disabled');
  });

  test('mounting while locked clears history held by an existing store reference', async () => {
    const store = useNotificationsStore();
    invoke.mockResolvedValue(history([entry]));
    await store.refresh();
    invoke.mockClear();
    useVaultStore().status = { state: 'locked', message: null, has_vault: true, generation: 2 };
    wrapper = mount(NotificationSettings, { localVue, router });
    await flush();
    expect(store.entries).toEqual([]);
    expect(store.loaded).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
