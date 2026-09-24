import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Home from '~/views/Home.vue';
import App from '~/App.vue';
import Footer from '~/components/Footer.vue';
import Settings from '~/views/settings/Settings.vue';

describe('PeakActivity bootstrap surfaces', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('home offers local navigation without upstream surveys or support links', () => {
    const wrapper = shallowMount(Home, { stubs: ['router-link'] });
    expect(wrapper.text()).toContain('PeakActivity');
    expect(wrapper.text()).toContain('Home / Today');
    expect(wrapper.text()).toContain('Local Vault');
    expect(wrapper.text()).toContain('Reports');
    expect(wrapper.text()).toContain('Manual timer');
    expect(wrapper.text()).toContain('Experimental');
    expect(wrapper.find('[role="status"][aria-live="polite"]').exists()).toBe(true);
    expect(wrapper.find('nav[aria-label="PeakActivity destinations"]').exists()).toBe(true);
    expect(wrapper.findAll('a[href^="http"]')).toHaveLength(0);
    expect(wrapper.text()).not.toMatch(/donate|survey|desktop parity/i);
  });

  test('Home summary includes only activity labels and durations', () => {
    const activity = {
      window: { top_apps: [{ data: { app: 'Editor', title: 'private title' }, duration: 120 }] },
      category: { top: [{ data: { $category: ['Work', 'Writing'] }, duration: 60 }] },
      stopwatch: { top_stopwatches: [{ data: { label: 'Deep work' }, duration: 90 }] },
    };
    const topApps = Home.computed.topApps.call({ activity });
    const topCategories = Home.computed.topCategories.call({ activity });
    const topManualEntries = Home.computed.topManualEntries.call({ activity });
    expect(topApps).toEqual([{ label: 'Editor', duration: 120 }]);
    expect(topCategories).toEqual([{ label: 'Work > Writing', duration: 60 }]);
    expect(topManualEntries).toEqual([{ label: 'Deep work', duration: 90 }]);
    expect(JSON.stringify(topApps)).not.toContain('private title');
  });

  test('explore without recording completes setup only after the vault is ready', async () => {
    const complete = jest.fn();
    await App.methods.exploreWithoutRecording.call({
      unlock: jest.fn().mockResolvedValue(undefined),
      vaultStore: { isReady: false },
      completeOnboarding: complete,
    });
    expect(complete).not.toHaveBeenCalled();
    await App.methods.exploreWithoutRecording.call({
      unlock: jest.fn().mockResolvedValue(undefined),
      vaultStore: { isReady: true },
      completeOnboarding: complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test('footer exposes local About and preserves derivative attribution', () => {
    const wrapper = shallowMount(Footer, { stubs: ['router-link'] });
    expect(wrapper.text()).toContain('ActivityWatch');
    expect(wrapper.text()).toContain('independent');
    expect(wrapper.findAll('a[href^="http"]')).toHaveLength(0);
    expect(wrapper.find('router-link-stub').attributes('to')).toBe('/about');
  });

  test('settings cannot re-enable the removed upstream release checker', () => {
    const groups = Settings.computed.groups.call({ $isAndroid: false });
    expect(groups.flatMap(group => group.components.map(component => component.name)))
      .not.toContain('ReleaseNotificationSettings');
  });

  test('privacy settings reflect the outbound firewall capability status', () => {
    const groups = Settings.computed.groups.call({ $isAndroid: false });
    expect(groups.find(group => group.id === 'privacy').help).toContain('Privacy Firewall approvals and receipts: Planned');
    expect(groups.find(group => group.id === 'privacy').components.map(component => component.name))
      .toContain('PrivacyFirewallSettings');
  });
});
