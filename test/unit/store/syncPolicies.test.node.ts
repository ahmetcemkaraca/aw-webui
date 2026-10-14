import { createPinia, setActivePinia } from 'pinia';
import { useSyncPolicyStore } from '~/stores/syncPolicies';
import { candidate, policyPreview, userPreview } from '../fixtures/policies';
const get = jest.fn(),
  post = jest.fn();
jest.mock('~/util/awclient', () => ({ getClient: () => ({ req: { get, post } }) }));
const context = (id = 'c'.repeat(64)) => ({
  data: JSON.stringify({ schema_version: 1, context_id: id }),
});
const reply = (value: any) => ({ data: JSON.stringify(value) });
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (value: any) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  setActivePinia(createPinia());
  get.mockReset().mockResolvedValue(context());
  post.mockReset();
});
async function reviewed(field = 'settings.theme') {
  const store = useSyncPolicyStore();
  post.mockResolvedValueOnce(
    reply({ schema_version: 1, candidates: [candidate(field)], next_cursor: null })
  );
  await store.load();
  post.mockResolvedValueOnce(
    reply(field === 'egress.user_policy' ? userPreview() : policyPreview(field))
  );
  await store.select(candidate(field).candidate_id);
  return store;
}
test('loads private metadata and preview as raw text without automatic choice', async () => {
  const store = await reviewed();
  expect(store.candidates).toHaveLength(1);
  expect(store.preview?.currentRaw).toBe('"dark"');
  expect(store.preview?.proposedRaw).toBe('"light"');
  expect(get).toHaveBeenCalledWith(
    '/0/sync/policies/context',
    expect.objectContaining({ responseType: 'text' })
  );
  expect(post).toHaveBeenNthCalledWith(
    1,
    '/0/sync/policies/list',
    { schema_version: 1, after: null, limit: 32 },
    expect.objectContaining({ responseType: 'text' })
  );
  expect(post.mock.calls.every(call => !call[0].endsWith('/choice'))).toBe(true);
});
test('explicit choice awaits native ACK and permits dependent application only while owned', async () => {
  const store = await reviewed();
  const pending = deferred();
  post.mockReturnValueOnce(pending.promise);
  const dirty = jest.fn(() => false);
  const choice = store.choose('accept-remote', dirty);
  await tick();
  expect(store.preview).not.toBeNull();
  expect(store.reloadPending).toBeNull();
  pending.resolve(
    reply({ schema_version: 1, field: 'settings.theme', decision: 'accept-remote', applied: true })
  );
  const ack = await choice;
  expect(ack?.applied).toBe(true);
  expect(store.preview).toBeNull();
  expect(store.reloadPending).toBe('settings.theme');
  expect(await store.canApplyChoice(ack!, dirty)).toBe(true);
  store.markReloaded(ack!);
  expect(store.reloadPending).toBeNull();
});
test('sends original full-width Firewall text rather than rounded numbers', async () => {
  const store = useSyncPolicyStore();
  post.mockResolvedValueOnce(
    reply({ schema_version: 1, candidates: [candidate('egress.user_policy')], next_cursor: null })
  );
  await store.load();
  post.mockResolvedValueOnce({
    data: JSON.stringify(userPreview()).replace(
      '"to_version":3',
      '"to_version":18446744073709551615'
    ),
  });
  await store.select('a'.repeat(64));
  post.mockResolvedValueOnce(
    reply({
      schema_version: 1,
      field: 'egress.user_policy',
      decision: 'accept-remote',
      applied: true,
    })
  );
  await store.choose('accept-remote', () => false);
  const call = post.mock.calls.find(call => call[0].endsWith('/choice'));
  expect(call?.[1]).toContain('18446744073709551615');
  expect(call?.[2].headers['Content-Type']).toBe('application/json');
});
test('accept blocks dirty state before request and again after awaited context', async () => {
  const store = await reviewed();
  post.mockClear();
  await store.choose('accept-remote', () => true);
  expect(post).not.toHaveBeenCalled();
  expect(store.error).toBe('draft');
  const pending = deferred();
  get.mockReturnValueOnce(pending.promise);
  let dirty = false;
  const choosing = store.choose('accept-remote', () => dirty);
  dirty = true;
  pending.resolve(context());
  await choosing;
  expect(post).not.toHaveBeenCalled();
  expect(store.preview).not.toBeNull();
});
test('draft begun while native choice waits remains untouched and keeps reload pending', async () => {
  const store = await reviewed();
  const pending = deferred();
  post.mockReturnValueOnce(pending.promise);
  let dirty = false;
  const choosing = store.choose('accept-remote', () => dirty);
  await tick();
  dirty = true;
  pending.resolve(
    reply({ schema_version: 1, field: 'settings.theme', decision: 'accept-remote', applied: true })
  );
  const ack = await choosing;
  expect(ack?.applied).toBe(true);
  expect(await store.canApplyChoice(ack!, () => dirty)).toBe(false);
  expect(store.reloadPending).toBe('settings.theme');
  dirty = false;
  expect(await store.canApplyChoice(ack!, () => dirty)).toBe(true);
});
test('keep local preserves drafts and resolves only after durable ACK without reload', async () => {
  const store = await reviewed();
  post.mockResolvedValueOnce(
    reply({ schema_version: 1, field: 'settings.theme', decision: 'keep-local', applied: false })
  );
  const ack = await store.choose('keep-local', () => true);
  expect(ack?.applied).toBe(false);
  expect(store.candidates).toEqual([]);
  expect(store.reloadPending).toBeNull();
});
test('away-and-back selection invalidates a late old preview even for the same ID', async () => {
  const store = await reviewed();
  const pending = deferred();
  post.mockReturnValueOnce(pending.promise);
  const old = store.select('a'.repeat(64));
  await tick();
  store.clearSelection();
  post.mockResolvedValueOnce(reply(policyPreview()));
  await store.select('a'.repeat(64));
  pending.resolve(reply(policyPreview('settings.theme', 'dark', 'auto')));
  await old;
  expect(store.preview?.proposedRaw).toBe('"light"');
});
test('changed actual worker context clears private data and suppresses stale ACK application', async () => {
  const store = await reviewed();
  const pending = deferred();
  post.mockReturnValueOnce(pending.promise);
  const choosing = store.choose('accept-remote', () => false);
  await tick();
  get.mockResolvedValue(context('d'.repeat(64)));
  pending.resolve(
    reply({ schema_version: 1, field: 'settings.theme', decision: 'accept-remote', applied: true })
  );
  expect(await choosing).toBeNull();
  expect(store.preview).toBeNull();
  expect(store.candidates).toEqual([]);
  expect(store.reloadPending).toBeNull();
  expect(store.error).toBe('context-changed');
});
test('fresh context failure clears a previously reviewed value rather than trusting cached readiness', async () => {
  const store = await reviewed();
  get.mockRejectedValueOnce(new Error('private backend detail'));
  await store.choose('accept-remote', () => false);
  expect(store.preview).toBeNull();
  expect(store.candidates).toEqual([]);
  expect(store.error).toBe('source-unavailable');
  expect(store.error).not.toContain('private');
});
test('clear and disposal invalidate pending success/error without reviving private values', async () => {
  for (const dispose of [false, true]) {
    const store = await reviewed();
    const pending = deferred();
    post.mockReturnValueOnce(pending.promise);
    const request = store.select('a'.repeat(64));
    await tick();
    if (dispose) store.$dispose();
    else store.clearSensitive();
    pending.reject(new Error('late private error'));
    await request;
    expect(store.preview).toBeNull();
    expect(store.candidates).toEqual([]);
    expect(store.busy).toBe(false);
    expect(store.error).toBeNull();
  }
});
test('malformed or already decoded replies cannot publish private state', async () => {
  const store = useSyncPolicyStore();
  post.mockResolvedValueOnce({
    data: { schema_version: 1, candidates: [candidate()], next_cursor: null },
  });
  await store.load();
  expect(store.error).toBe('invalid-response');
  expect(store.candidates).toEqual([]);
});

test('disposed held stores do not start a new request or revive busy state', async () => {
  const store = await reviewed();
  store.$dispose();
  get.mockClear();
  post.mockClear();
  await store.load();
  await store.select('a'.repeat(64));
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
  expect(store.error).toBeNull();
});
test('selection clearing cannot orphan an acknowledged pending reload', async () => {
  const store = await reviewed();
  post.mockResolvedValueOnce(
    reply({ schema_version: 1, field: 'settings.theme', decision: 'accept-remote', applied: true })
  );
  const ack = await store.choose('accept-remote', () => false);
  store.clearSelection();
  expect(store.reloadPending).toBe('settings.theme');
  expect(await store.canApplyChoice(ack!, () => false)).toBe(true);
});
test('a transient context failure after durable choice retains only the same-ACK retry marker', async () => {
  const store=await reviewed();post.mockResolvedValueOnce(reply({schema_version:1,field:'settings.theme',decision:'accept-remote',applied:true}));
  get.mockResolvedValueOnce(context()).mockRejectedValueOnce({response:{status:503}});
  const ack=await store.choose('accept-remote',()=>false);
  expect(ack?.applied).toBe(true);expect(store.lastChoice).toBe(ack);expect(store.reloadPending).toBe('settings.theme');expect(store.preview).toBeNull();expect(store.candidates).toEqual([]);
  get.mockResolvedValue(context());expect(await store.canApplyChoice(ack!,()=>false)).toBe(true);store.markReloaded(ack!);expect(store.reloadPending).toBeNull();expect(post.mock.calls.filter(call=>call[0].endsWith('/choice'))).toHaveLength(1);
});
test('a transient context read during reload cannot orphan native acknowledgement but actual lock clears it', async () => {
  const store=await reviewed();post.mockResolvedValueOnce(reply({schema_version:1,field:'settings.theme',decision:'accept-remote',applied:true}));
  const ack=await store.choose('accept-remote',()=>false);get.mockRejectedValueOnce({response:{status:503}});
  expect(await store.canApplyChoice(ack!,()=>false)).toBe(false);expect(store.lastChoice).toBe(ack);expect(store.reloadPending).toBe('settings.theme');
  get.mockRejectedValueOnce({response:{status:423}});expect(await store.canApplyChoice(ack!,()=>false)).toBe(false);expect(store.lastChoice).toBeNull();expect(store.reloadPending).toBeNull();
});
