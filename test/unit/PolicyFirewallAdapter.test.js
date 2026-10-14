import { shallowMount } from '@vue/test-utils';
import Firewall from '~/views/settings/PrivacyFirewallSettings.vue';
import { clearPolicyDrafts, hasPolicyDrafts, reloadPolicyDrafts } from '~/util/policyDrafts';
const mockGet = jest.fn();
jest.mock('~/util/awclient', () => ({ getClient: () => ({ req: { get: mockGet } }) }));
const policy = () => ({
  schema_version: 1,
  user_rules: [],
  safe_zone_patterns: [],
  after_hours: null,
});
let wrapper, currentPolicy;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
beforeEach(() => {
  clearPolicyDrafts();
  mockGet.mockReset();
  currentPolicy = policy();
  mockGet.mockImplementation(url =>
    Promise.resolve({
      data: url.endsWith('/user-policy')
        ? currentPolicy
        : url.endsWith('/status')
        ? { kill_switch_enabled: true, policy_bundle_stored: false, trusted_policy_keys: 0 }
        : [],
    })
  );
});
afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  clearPolicyDrafts();
});
test('hidden Firewall user and signed drafts block accepted reload', async () => {
  wrapper = shallowMount(Firewall);
  await flush();
  expect(hasPolicyDrafts()).toBe(false);
  await wrapper.setData({ signedPolicyJson: 'private draft' });
  expect(hasPolicyDrafts()).toBe(true);
  expect(await reloadPolicyDrafts('egress.user_policy', async () => true)).toBe(false);
  await wrapper.setData({ signedPolicyJson: '' });
  wrapper.vm.userPolicy.user_rules.push({
    pattern: { kind: 'keyword', value: 'banking' },
    action: 'deny',
  });
  expect(hasPolicyDrafts()).toBe(true);
});
test('clean Firewall callback uses the actual API prefix and refreshes native user state', async () => {
  wrapper = shallowMount(Firewall);
  await flush();
  currentPolicy = { ...policy(), safe_zone_patterns: [{ kind: 'application', value: 'Editor' }] };
  expect(await reloadPolicyDrafts('egress.signed_bundle', async () => true)).toBe(true);
  expect(wrapper.vm.savedPolicy.safe_zone_patterns).toHaveLength(1);
  expect(mockGet.mock.calls.every(call => call[0].startsWith('/0/egress/'))).toBe(true);
});
test('a lost reload owner cannot publish a later Firewall response', async () => {
  wrapper = shallowMount(Firewall);
  await flush();
  let resolve;
  mockGet.mockImplementation(url =>
    url.endsWith('/user-policy')
      ? new Promise(yes => {
          resolve = yes;
        })
      : Promise.resolve({
          data: url.endsWith('/status')
            ? { kill_switch_enabled: true, policy_bundle_stored: false, trusted_policy_keys: 0 }
            : [],
        })
  );
  let current = true;
  const refresh = wrapper.vm.refresh(async () => current);
  await flush();
  current = false;
  resolve({ data: { ...policy(), safe_zone_patterns: [{ kind: 'application', value: 'late' }] } });
  expect(await refresh).toBe(false);
  expect(wrapper.vm.savedPolicy.safe_zone_patterns).toEqual([]);
});
