import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Panel from '~/components/SyncPolicyReview.vue';
import { useSyncPolicyStore } from '~/stores/syncPolicies';
import { useSettingsStore } from '~/stores/settings';
import { clearPolicyDrafts, registerPolicyDraft } from '~/util/policyDrafts';
import { candidate, policyPreview, userPreview } from './fixtures/policies';
const mockGet = jest.fn(),
  mockPost = jest.fn(),
  mockSettings = jest.fn();
jest.mock('~/util/awclient', () => ({
  getClient: () => ({ req: { get: mockGet, post: mockPost }, get_settings: mockSettings }),
}));
const reply = value => ({ data: JSON.stringify(value) });
const context = id => reply({ schema_version: 1, context_id: (id || 'c').repeat(64) });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
};
let wrapper, field, value, ack;
beforeEach(() => {
  setActivePinia(createPinia());
  clearPolicyDrafts();
  useSettingsStore()._loaded = true;
  useSettingsStore().theme = 'dark';
  field = 'settings.theme';
  value = policyPreview();
  ack = { schema_version: 1, field, decision: 'accept-remote', applied: true };
  mockGet.mockReset().mockResolvedValue(context());
  mockSettings.mockReset().mockResolvedValue({ theme: 'light' });
  mockPost
    .mockReset()
    .mockImplementation(path =>
      Promise.resolve(
        reply(
          path.endsWith('/list')
            ? { schema_version: 1, candidates: [candidate(field)], next_cursor: null }
            : path.endsWith('/preview')
            ? value
            : ack
        )
      )
    );
});
afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  clearPolicyDrafts();
});
async function setup(propsData = {}) {
  wrapper = mount(Panel, { propsData });
  await flush();
}
async function select() {
  await wrapper.find('[data-policy-review]').trigger('click');
  await flush();
}
test('shows exact reviewed values and makes no automatic choice', async () => {
  await setup();
  await select();
  expect(wrapper.text()).toContain('Theme');
  expect(wrapper.find('[data-policy-current]').text()).toBe('"dark"');
  expect(wrapper.find('[data-policy-proposed]').text()).toBe('"light"');
  expect(mockPost.mock.calls.some(call => call[0].endsWith('/choice'))).toBe(false);
  expect(mockSettings).not.toHaveBeenCalled();
});
test('hidden settings panel waits for actual activation before loading', async () => {
  await setup({ active: false });
  expect(mockGet).not.toHaveBeenCalled();
  await wrapper.setProps({ active: true });
  await flush();
  expect(useSyncPolicyStore().candidates).toHaveLength(1);
});
test('keep local remains explicit, preserves drafts and never reloads', async () => {
  let dirty = true;
  registerPolicyDraft(['settings.theme'], { blocked: () => dirty });
  ack = { ...ack, decision: 'keep-local', applied: false };
  await setup();
  await select();
  expect(wrapper.find('[data-policy-accept]').attributes('disabled')).toBeDefined();
  await wrapper.find('[data-policy-keep]').trigger('click');
  await flush();
  expect(mockSettings).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('Local value kept');
});
test('accept reloads only after the durable native acknowledgement', async () => {
  const pending = deferred();
  await setup();
  await select();
  mockPost.mockReturnValueOnce(pending.promise);
  const choosing = wrapper.vm.choose('accept-remote');
  await flush();
  expect(mockSettings).not.toHaveBeenCalled();
  expect(useSettingsStore().theme).toBe('dark');
  pending.resolve(reply(ack));
  await choosing;
  expect(useSettingsStore().theme).toBe('light');
  expect(useSyncPolicyStore().reloadPending).toBeNull();
});
test('a draft during ACK waits, then retry uses the same ACK without a second choice', async () => {
  let dirty = false;
  registerPolicyDraft(['settings.theme'], { blocked: () => dirty });
  const pending = deferred();
  await setup();
  await select();
  mockPost.mockReturnValueOnce(pending.promise);
  const choosing = wrapper.vm.choose('accept-remote');
  await flush();
  dirty = true;
  pending.resolve(reply(ack));
  await choosing;
  expect(useSettingsStore().theme).toBe('dark');
  expect(useSyncPolicyStore().reloadPending).toBe(field);
  dirty = false;
  await wrapper.vm.applyPending();
  expect(useSettingsStore().theme).toBe('light');
  expect(mockPost.mock.calls.filter(call => call[0].endsWith('/choice'))).toHaveLength(1);
});
test('failed capture-style callback retains pending state and retry does not repost', async () => {
  let fail = true;
  const reload = jest.fn(async () => {
    if (fail) throw new Error('read failure');
  });
  registerPolicyDraft(['settings.theme'], { blocked: () => false, reload });
  await setup();
  await select();
  await wrapper.vm.choose('accept-remote');
  expect(useSyncPolicyStore().reloadPending).toBe(field);
  fail = false;
  await wrapper.vm.applyPending();
  expect(useSyncPolicyStore().reloadPending).toBeNull();
  expect(reload).toHaveBeenCalledTimes(2);
  expect(mockPost.mock.calls.filter(call => call[0].endsWith('/choice'))).toHaveLength(1);
});
test('destruction during native snapshot fetch prevents late settings publication', async () => {
  const pending = deferred();
  mockSettings.mockReturnValue(pending.promise);
  await setup();
  await select();
  const choosing = wrapper.vm.choose('accept-remote');
  await flush();
  wrapper.destroy();
  wrapper = null;
  pending.resolve({ theme: 'light' });
  await choosing;
  expect(useSettingsStore().theme).toBe('dark');
  expect(useSyncPolicyStore().lastChoice).toBeNull();
});
test('a changed vault context before accept clears reviewed values and posts no choice', async () => {
  await setup();
  await select();
  mockGet.mockResolvedValue(context('d'));
  await wrapper.vm.choose('accept-remote');
  expect(useSyncPolicyStore().preview).toBeNull();
  expect(mockSettings).not.toHaveBeenCalled();
  expect(mockPost.mock.calls.some(call => call[0].endsWith('/choice'))).toBe(false);
  expect(wrapper.text()).toContain('vault changed');
});
test('untrusted Firewall values remain visible and keepable with acceptance disabled', async () => {
  field = 'egress.user_policy';
  value = {
    ...userPreview(),
    firewall: null,
    accept_remote_available: false,
    reason: 'firewall-review-unavailable',
  };
  ack = { schema_version: 1, field, decision: 'keep-local', applied: false };
  await setup();
  await select();
  expect(wrapper.find('[data-policy-proposed]').text()).toContain('Editor');
  expect(wrapper.find('[data-policy-accept]').attributes('disabled')).toBeDefined();
  expect(wrapper.find('[data-policy-keep]').attributes('disabled')).toBeUndefined();
  await wrapper.vm.choose('keep-local');
  expect(mockSettings).not.toHaveBeenCalled();
});
test('reset, stored null and empty lists are visibly distinct', async () => {
  field = 'settings.classes';
  value = policyPreview(field, null, []);
  value.policy.current.present = false;
  await setup();
  await select();
  expect(wrapper.find('[data-policy-current]').text()).toContain('Default');
  expect(wrapper.find('[data-policy-proposed]').text()).toBe('[]');
  value = policyPreview(field, null, []);
  await wrapper.vm.policies.select(candidate(field).candidate_id);
  await flush();
  expect(wrapper.find('[data-policy-current]').text()).toBe('null');
});
test('markup in private values is escaped', async () => {
  field = 'settings.saved_queries';
  value = policyPreview(
    field,
    [{ id: 'unsafe', name: '<img src=x onerror=alert(1)>', query_code: 'RETURN []' }],
    []
  );
  await setup();
  await select();
  expect(wrapper.find('[data-policy-current] img').exists()).toBe(false);
  expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
});
test('hiding during native ACK defers reload and returning preserves the same acknowledgement', async () => {
  const pending = deferred();
  await setup();
  await select();
  mockPost.mockReturnValueOnce(pending.promise);
  const choosing = wrapper.vm.choose('accept-remote');
  await flush();
  await wrapper.setProps({ active: false });
  pending.resolve(reply(ack));
  await choosing;
  expect(useSettingsStore().theme).toBe('dark');
  expect(useSyncPolicyStore().reloadPending).toBe(field);
  await wrapper.setProps({ active: true });
  await wrapper.vm.applyPending();
  expect(useSettingsStore().theme).toBe('light');
  expect(mockPost.mock.calls.filter(call => call[0].endsWith('/choice'))).toHaveLength(1);
});
test('hiding during authoritative fetch preserves local values and the same ACK for retry', async () => {
  const pending = deferred();
  mockSettings.mockReturnValueOnce(pending.promise);
  await setup();
  await select();
  const choosing = wrapper.vm.choose('accept-remote');
  await flush();
  await wrapper.setProps({ active: false });
  pending.resolve({ theme: 'light' });
  await choosing;
  expect(useSettingsStore().theme).toBe('dark');
  expect(useSyncPolicyStore().reloadPending).toBe(field);
  await wrapper.setProps({ active: true });
  await wrapper.vm.applyPending();
  expect(useSettingsStore().theme).toBe('light');
  expect(mockPost.mock.calls.filter(call => call[0].endsWith('/choice'))).toHaveLength(1);
});
test('full-width Firewall version reaches the actual choice without rounding', async () => {
  field = 'egress.user_policy';
  value = userPreview();
  ack = { ...ack, field };
  const usual = mockPost.getMockImplementation();
  mockPost.mockImplementation(path =>
    path.endsWith('/preview')
      ? Promise.resolve({
          data: JSON.stringify(value).replace(
            '"to_version":3',
            '"to_version":18446744073709551615'
          ),
        })
      : usual(path)
  );
  await setup();
  await select();
  await wrapper.vm.choose('accept-remote');
  expect(mockPost.mock.calls.find(call => call[0].endsWith('/choice'))[1]).toContain(
    '18446744073709551615'
  );
});
test('recovered candidates show authenticated snapshot provenance instead of a device label',async()=>{
  const source={schema_version:1,vault_id:'AgICAgICAgICAgICAgICAg',key_epoch:'1',snapshot_id:'AwMDAwMDAwMDAwMDAwMDAw'};
  const recovered={...candidate(),device_id:source.snapshot_id,recovery_source:source};
  mockPost.mockImplementation(path=>Promise.resolve(reply(path.endsWith('/list')?{schema_version:1,candidates:[recovered],next_cursor:null}:path.endsWith('/preview')?{...value,policy:{...value.policy,candidate:recovered}}:ack)));
  await setup();expect(wrapper.text()).toContain('Recovery snapshot');expect(wrapper.text()).not.toContain(`Device ${source.snapshot_id}`);
  await select();expect(useSyncPolicyStore().preview.policy.candidate.recovery_source).toEqual(source);
});
