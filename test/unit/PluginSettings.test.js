import { shallowMount } from '@vue/test-utils';
import PluginSettings from '~/views/settings/PluginSettings.vue';
import PluginActions from '~/components/PluginActions.vue';
import { getClient } from '~/util/awclient';
import { useAIStore } from '~/stores/ai';
jest.mock('~/util/awclient', () => ({ getClient: jest.fn() }));
jest.mock('~/stores/ai', () => ({ useAIStore: jest.fn() }));
const plugin = () => ({ manifest: { plugin_id: 'test-plugin', display_name: 'Synthetic plugin', version: '1.0.0', publisher_key_id: 'test', capabilities: { read: [] } }, package_sha256: 'package-hash', enabled: false, revoked: false, consent_required: true });
const status = available => ({ runtime_compiled: true, runtime_available: available, lifecycle_available: true, marketplace_available: false, signed_purpose_available: false, blocker_ids: ['publisher_trust_registry'] });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let req;
beforeEach(() => {
  req = { get: jest.fn(url => Promise.resolve({ data: url.endsWith('/status') ? status(false) : { plugins: [plugin()] } })), post: jest.fn().mockResolvedValue({ data: {} }), delete: jest.fn().mockResolvedValue({ data: {} }) };
  getClient.mockReturnValue({ req });
  useAIStore.mockReturnValue({ settings: null, busy: false, refresh: jest.fn(), clearPreview: jest.fn() });
});
test('closed release gates disable install, consent and invocation but allow cleanup review', async () => {
  const wrapper = shallowMount(PluginSettings);
  await flush();
  expect(wrapper.find('#plugin-package').attributes('disabled')).toBeDefined();
  wrapper.vm.candidate = { manifest: plugin().manifest };
  wrapper.vm.moduleBytes = [0];
  wrapper.vm.packageConfirmed = true;
  await wrapper.vm.install();
  await wrapper.vm.invoke({ ...plugin(), enabled: true, consent_required: false });
  wrapper.vm.confirmAction(plugin(), 'consent');
  expect(wrapper.vm.confirmation).toBeNull();
  expect(req.post).not.toHaveBeenCalled();
  wrapper.vm.confirmAction(plugin(), 'delete');
  expect(wrapper.vm.confirmation.action).toBe('delete');
  wrapper.destroy();
});
test('delete requires confirmation bound to the exact package', async () => {
  const wrapper = shallowMount(PluginSettings);
  await flush();
  wrapper.vm.confirmAction(plugin(), 'delete');
  await wrapper.vm.applyAction();
  expect(req.delete).not.toHaveBeenCalled();
  wrapper.vm.actionConfirmed = true;
  await wrapper.vm.applyAction();
  expect(req.delete).toHaveBeenCalledWith('/api/0/plugins/test-plugin', { data: { package_sha256: 'package-hash', confirmed: true } });
  wrapper.destroy();
});
test('update binds current package and displays diff without automatically granting consent', async () => {
  req.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? status(true) : { plugins: [plugin()] } }));
  req.post.mockResolvedValue({ data: { plugin: plugin(), capability_diff: { added: ['read/new'], removed: [], requires_reconsent: true } } });
  const wrapper = shallowMount(PluginSettings);
  await flush();
  wrapper.vm.candidate = { schema_version: 1, manifest: plugin().manifest };
  wrapper.vm.moduleBytes = [0, 97, 115, 109];
  wrapper.vm.packageConfirmed = true;
  await wrapper.vm.install();
  expect(req.post).toHaveBeenCalledTimes(1);
  expect(req.post.mock.calls[0][0]).toBe('/api/0/plugins/test-plugin/update');
  expect(req.post.mock.calls[0][1].expected_package_sha256).toBe('package-hash');
  expect(wrapper.text()).toContain('read/new');
  expect(wrapper.vm.packageConfirmed).toBe(false);
  wrapper.destroy();
});
test('failed refresh removes stale executable status and pending approvals', async () => {
  const wrapper = shallowMount(PluginSettings);
  await flush();
  wrapper.vm.status = status(true);
  wrapper.vm.confirmation = { action: 'consent', plugin: plugin() };
  req.get.mockRejectedValue(new Error('offline'));
  await wrapper.vm.refresh();
  expect(wrapper.vm.canRun).toBe(false);
  expect(wrapper.vm.confirmation).toBeNull();
  expect(wrapper.find('[role="alert"]').text()).toContain('could not be loaded');
  wrapper.destroy();
});
function actions(overrides = {}) {
  return shallowMount(PluginActions, { propsData: { available: true, plugin: plugin(), invocation: { invocation_id: 'invocation', expires_at: new Date(Date.now() + 60000).toISOString(), ui: [], writes: [{ payload: { title: '<script>untrusted</script>', body: 'Note' } }], network_previews: [], ai_requests: [], destructive_confirmations: [], ...overrides } } });
}
test('annotation approval is explicit, package-bound, and one attempt per preview', async () => {
  const wrapper = actions();
  await wrapper.vm.approveWrites();
  expect(req.post).not.toHaveBeenCalled();
  expect(wrapper.find('script').exists()).toBe(false);
  wrapper.vm.writesConfirmed = true;
  await wrapper.vm.approveWrites();
  expect(req.post).toHaveBeenCalledWith('/api/0/plugins/test-plugin/writes/approve', { invocation_id: 'invocation', package_sha256: 'package-hash', confirmed: true });
  wrapper.vm.writesConfirmed = true;
  await wrapper.vm.approveWrites();
  expect(req.post).toHaveBeenCalledTimes(1);
  wrapper.destroy();
});
test('expired invocation cannot save annotations', async () => {
  const wrapper = actions({ expires_at: '2000-01-01T00:00:00Z' });
  wrapper.vm.writesConfirmed = true;
  await wrapper.vm.approveWrites();
  expect(req.post).not.toHaveBeenCalled();
  expect(wrapper.vm.error).toContain('expired');
  wrapper.destroy();
});
test('network sends require disclosure and explicit approval through existing Egress', async () => {
  const preview = { destination_origin: 'https://synthetic.example', purpose_id: 'test', retention_disclosure: 'Synthetic retention', decision: { preview_id: 'preview', outcome: 'allow', policy_version: 1, reason_codes: [], removed_fields: [], sanitized_payload: { count: 1 } } };
  const wrapper = actions({ network_previews: [preview, { ...preview, destination_origin: null }] });
  await wrapper.vm.sendNetwork(0);
  expect(req.post).not.toHaveBeenCalled();
  wrapper.vm.networkConfirmed[1] = true;
  await wrapper.vm.sendNetwork(1);
  expect(req.post).not.toHaveBeenCalled();
  req.post.mockResolvedValueOnce({ data: { approval_id: 'approval' } });
  wrapper.vm.networkConfirmed[0] = true;
  await wrapper.vm.sendNetwork(0);
  expect(req.post.mock.calls.map(call => call[0])).toEqual(['/api/0/egress/approve', '/api/0/egress/send']);
  expect(req.post.mock.calls[1][1]).toEqual({ preview_id: 'preview', approval_id: 'approval' });
  wrapper.vm.networkConfirmed[0] = true;
  await wrapper.vm.sendNetwork(0);
  expect(req.post).toHaveBeenCalledTimes(2);
  wrapper.destroy();
});

test('AI intents remain editable drafts for the active connection and never send automatically', async () => {
  const store = { settings: { active_connection_id: 'active-profile' }, busy: false, refresh: jest.fn(), clearPreview: jest.fn() };
  useAIStore.mockReturnValue(store);
  const request = { profile_id: 'active-profile', feature: 'report_explanation', question: 'Explain synthetic count', aggregate: { event_count: 2 } };
  const wrapper = actions({ ai_requests: [request] });
  const draft = wrapper.findComponent({ name: 'AIReportExplanation' });
  expect(draft.exists()).toBe(true);
  expect(draft.props('aggregate')).toEqual(request.aggregate);
  expect(draft.props('defaultQuestion')).toBe(request.question);
  expect(draft.props('features')).toEqual([request.feature]);
  expect(req.post).not.toHaveBeenCalled();
  store.settings.active_connection_id = 'other-profile';
  await wrapper.vm.$nextTick();
  expect(wrapper.findComponent({ name: 'AIReportExplanation' }).exists()).toBe(false);
  wrapper.destroy();
  expect(store.clearPreview).toHaveBeenCalled();
});

test('pending action approval blocks lifecycle changes without clearing an ongoing host operation', async () => {
  const wrapper = shallowMount(PluginSettings);
  await flush();
  wrapper.vm.actionsBusy = true;
  wrapper.vm.confirmAction(plugin(), 'revoke');
  expect(wrapper.vm.confirmation).toBeNull();
  wrapper.vm.working = true;
  wrapper.vm.actionsBusy = false;
  expect(wrapper.vm.busy).toBe(true);
  wrapper.vm.working = false;
  wrapper.vm.confirmAction(plugin(), 'revoke');
  expect(wrapper.vm.confirmation.action).toBe('revoke');
  wrapper.destroy();
});

test('pending background previews require an unexpired matching package and do not auto-approve', async () => {
  req.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? status(true) : url.endsWith('/pending') ? { invocations: [] } : { plugins: [plugin()] } }));
  const wrapper = shallowMount(PluginSettings);
  await flush();
  await wrapper.vm.loadPending(plugin());
  expect(req.get).toHaveBeenCalledWith('/api/0/plugins/test-plugin/pending');
  expect(wrapper.vm.pendingPlugin.manifest.plugin_id).toBe('test-plugin');
  const preview = { invocation_id: 'queued', package_sha256: 'package-hash', background: true, expires_at: new Date(Date.now() + 60000).toISOString() };
  wrapper.vm.openPreview(plugin(), { ...preview, package_sha256: 'other-package' });
  expect(wrapper.vm.invocation).toBeNull();
  wrapper.vm.openPreview(plugin(), { ...preview, expires_at: 'invalid' });
  expect(wrapper.vm.invocation).toBeNull();
  wrapper.vm.openPreview(plugin(), preview);
  expect(wrapper.vm.invocation.invocation_id).toBe('queued');
  expect(req.post).not.toHaveBeenCalled();
  wrapper.destroy();
});

test('scoped deletion requires confirmation and binds the server action index without accepting replacement data', async () => {
  const action = { action: 'delete', resource_id: 'plugin_owned_data', snapshot_sha256: 'snapshot', storage_keys: ['theme'], event_count: 2, payload_bytes: 40, approved: false };
  const wrapper = actions({ destructive_confirmations: [action, { ...action, resource_id: 'raw_vault' }] });
  await wrapper.vm.approveAction(0);
  wrapper.vm.actionsConfirmed[1] = true;
  await wrapper.vm.approveAction(1);
  expect(req.post).not.toHaveBeenCalled();
  req.post.mockResolvedValue({ data: { action: 'delete', ok: true } });
  wrapper.vm.actionsConfirmed[0] = true;
  await wrapper.vm.approveAction(0);
  expect(req.post).toHaveBeenCalledWith('/api/0/plugins/test-plugin/actions/approve', { package_sha256: 'package-hash', invocation_id: 'invocation', action_index: 0, confirmed: true });
  wrapper.vm.actionsConfirmed[0] = true;
  await wrapper.vm.approveAction(0);
  expect(req.post).toHaveBeenCalledTimes(1);
  expect(wrapper.vm.notice).toContain('Activity data was preserved');
  wrapper.destroy();
});

test('plugin export downloads only after explicit approval of the exact server snapshot', async () => {
  jest.useFakeTimers();
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn().mockReturnValue('blob:synthetic-export');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const wrapper = actions({ writes_approved: true, destructive_confirmations: [{ action: 'export', resource_id: 'plugin_owned_data', snapshot_sha256: 'snapshot', storage_keys: [], event_count: 0, payload_bytes: 2, approved: false }] });
  await wrapper.vm.approveAction(0);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  wrapper.vm.actionsConfirmed[0] = true;
  req.post.mockResolvedValue({ data: { action: 'export', data: { storage: {}, events: [] } } });
  await wrapper.vm.approveAction(0);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(click.mock.instances[0].download).toBe('test-plugin-data.json');
  expect(wrapper.vm.writesSaved).toBe(true);
  expect(wrapper.vm.notice).toContain('download requested');
  jest.runAllTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-export');
  wrapper.destroy();
  click.mockRestore();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  jest.useRealTimers();
});

test('scoped send releases a withheld preview but requires a fresh separate Firewall confirmation', async () => {
  const preview = { destination_origin: 'https://synthetic.example', purpose_id: 'test', retention_disclosure: 'Synthetic retention', decision: { preview_id: '', outcome: 'allow', policy_version: 1, reason_codes: [], removed_fields: [], sanitized_payload: {} } };
  const wrapper = actions({ network_previews: [preview], destructive_confirmations: [{ action: 'send', resource_id: 'network:0', snapshot_sha256: 'snapshot', storage_keys: [], event_count: 0, payload_bytes: 2, approved: false }] });
  wrapper.vm.networkConfirmed[0] = true;
  await wrapper.vm.sendNetwork(0);
  expect(req.post).not.toHaveBeenCalled();
  wrapper.vm.actionsConfirmed[0] = true;
  req.post.mockResolvedValueOnce({ data: { action: 'send', network_preview: { ...preview, decision: { ...preview.decision, preview_id: 'released' } } } });
  await wrapper.vm.approveAction(0);
  expect(req.post).toHaveBeenCalledTimes(1);
  expect(wrapper.vm.networkConfirmed[0]).toBe(false);
  await wrapper.vm.sendNetwork(0);
  expect(req.post).toHaveBeenCalledTimes(1);
  wrapper.vm.networkConfirmed[0] = true;
  req.post.mockResolvedValueOnce({ data: { approval_id: 'approval' } });
  await wrapper.vm.sendNetwork(0);
  expect(req.post.mock.calls.map(call => call[0])).toEqual(['/api/0/plugins/test-plugin/actions/approve', '/api/0/egress/approve', '/api/0/egress/send']);
  wrapper.destroy();
});
