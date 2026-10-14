import { createPinia, setActivePinia } from 'pinia';
import { useBackupStore } from '~/stores/backups';
const invoke = jest.fn(),
  get = jest.fn(),
  post = jest.fn();
jest.mock('~/util/awclient', () => ({
  getClient: () => ({ req: { get, post } }),
  invokeAndroidNative: (...args: any[]) => invoke(...args),
}));
const ctx = 'c'.repeat(64),
  id = 'AAAAAAAAAAAAAAAAAAAAAA';
const selection = (snapshot = id) => ({
  schema_version: 1,
  source_id: 'local',
  vault_id: id,
  key_epoch: '18446744073709551615',
  snapshot_id: snapshot,
  object_count: 1,
  bundle_sha256: 'a'.repeat(64),
});
const row = (snapshot = id, status = 'authenticated') => ({
  snapshot_id: snapshot,
  key_epoch: '18446744073709551615',
  object_count: 1,
  declared_object_count: 1,
  status,
  selection: status === 'authenticated' ? selection(snapshot) : null,
  event_count: status === 'authenticated' ? 2 : null,
  query_start: status === 'authenticated' ? '2026-10-01T12:00:00Z' : null,
  query_end: status === 'authenticated' ? '2026-10-01T13:00:00Z' : null,
  policy_continuity_present: status === 'authenticated' ? true : null,
});
const catalogue = (versions: any[] = [row()]) => ({
  schema_version: 1,
  source_id: 'local',
  context_id: ctx,
  vault_id: id,
  key_epoch: '18446744073709551615',
  requires_recovery_kit: false,
  namespaces: [],
  versions,
  invalid_object_count: 0,
  operation_object_count: 0,
});
let context = ctx;
beforeEach(() => {
  setActivePinia(createPinia());
  context = ctx;
  invoke
    .mockReset()
    .mockImplementation(async (command: string) =>
      command === 'get_sync_backup_context'
        ? { schema_version: 1, context_id: context }
        : command === 'list_sync_backups'
        ? catalogue()
        : null
    );
  (global as any).window = { __TAURI__: { core: { invoke } } };
  get.mockReset();
  post.mockReset();
});
const defer = () => {
  let resolve!: (v: any) => void;
  const promise = new Promise<any>(r => (resolve = r));
  return { promise, resolve };
};
test('lists retained versions without creating or sending to a provider', async () => {
  invoke.mockImplementation(async (c: string) =>
    c === 'get_sync_backup_context'
      ? { schema_version: 1, context_id: ctx }
      : catalogue([
          row(),
          row('AQEBAQEBAQEBAQEBAQEBAQ'),
          row('AgICAgICAgICAgICAgICAg', 'incomplete'),
        ])
  );
  const s = useBackupStore();
  await s.load();
  expect(s.versions).toHaveLength(3);
  s.select(s.versions[2]);
  expect(s.selected).toBeNull();
  expect(post).not.toHaveBeenCalled();
  expect(invoke.mock.calls.some(c => c[0] === 'create_current_sync_snapshot')).toBe(false);
});
test('exports selected raw ciphertext without rounding epoch or creating snapshot', async () => {
  const s = useBackupStore();
  await s.load();
  s.select(s.versions[0]);
  const raw = '{"key_epoch":18446744073709551615,"ciphertext":"opaque"}';
  invoke.mockImplementation(async (c: string) =>
    c === 'get_sync_backup_context' ? { schema_version: 1, context_id: ctx } : raw
  );
  await s.exportSelected();
  expect(s.exportRaw).toBe(raw);
  const call = invoke.mock.calls.find(c => c[0] === 'export_selected_sync_backup');
  expect(call?.[1].requestJson).toContain('"key_epoch":"18446744073709551615"');
  expect(invoke.mock.calls.some(c => c[0] === 'create_current_sync_snapshot')).toBe(false);
});
test.each(['clear', 'dispose', 'source'])('late catalogue cannot publish after %s', async what => {
  const pending = defer();
  const s = useBackupStore();
  invoke.mockImplementation(async (c: string) =>
    c === 'get_sync_backup_context' ? { schema_version: 1, context_id: ctx } : pending.promise
  );
  const work = s.load();
  await Promise.resolve();
  await Promise.resolve();
  if (what === 'clear') s.clearSensitive();
  else if (what === 'dispose') s.$dispose();
  else s.configure({ mode: 'folder', folderPath: '/private/backups', kitRaw: '', phrase: '' });
  pending.resolve(catalogue());
  await work;
  expect(s.versions).toHaveLength(0);
  expect(s.exportRaw).toBe('');
});
test('changed worker after response clears selection and ciphertext', async () => {
  const s = useBackupStore();
  await s.load();
  s.select(s.versions[0]);
  context = 'd'.repeat(64);
  await s.exportSelected();
  expect(s.selected).toBeNull();
  expect(s.exportRaw).toBe('');
  expect(s.error).toBeTruthy();
});
test('input kit stays raw and changed phrase clears reviews', async () => {
  const s = useBackupStore();
  s.configure({
    mode: 'local',
    folderPath: '',
    kitRaw: '{"key_epoch":18446744073709551615}',
    phrase: 'private',
  });
  await s.load();
  const call = invoke.mock.calls.find(c => c[0] === 'list_sync_backups');
  expect(call?.[1].requestJson).toContain('"key_epoch":18446744073709551615');
  s.select(s.versions[0]);
  s.configure({
    mode: 'local',
    folderPath: '',
    kitRaw: '{"key_epoch":18446744073709551615}',
    phrase: 'changed',
  });
  expect(s.selected).toBeNull();
  s.clearSensitive();
  expect(s.phrase).toBe('');
  expect(s.kitRaw).toBe('');
});
test('restore requires its own metadata review and explicit acceptance', async () => {
  const s = useBackupStore();
  s.configure({ mode: 'local', folderPath: '', kitRaw: '{}', phrase: 'private' });
  await s.load();
  s.select(s.versions[0]);
  await s.restoreSelected(false);
  expect(invoke.mock.calls.some(c => c[0] === 'restore_selected_sync_backup')).toBe(false);
  invoke.mockImplementation(async (c: string) =>
    c === 'get_sync_backup_context'
      ? { schema_version: 1, context_id: ctx }
      : JSON.stringify({
          schema_version: 1,
          vault_id: id,
          key_epoch: 1,
          snapshot_id: id,
          object_count: 1,
          query_start: null,
          query_end: null,
          policy_continuity_present: true,
          policy_conflict_count: 0,
        }).replace('"key_epoch":1', '"key_epoch":18446744073709551615')
  );
  await s.previewRestore();
  expect(s.restorePreview).toBeTruthy();
  await s.restoreSelected(true);
  expect(
    invoke.mock.calls.find(c => c[0] === 'restore_selected_sync_backup')?.[1].userAccepted
  ).toBe(true);
});
test('no explicit provider acceptance means no approve or transfer request', async () => {
  const s = useBackupStore();
  await s.load();
  s.select(s.versions[0]);
  await s.runProvider(false);
  expect(post).not.toHaveBeenCalled();
});
const remoteSource = 'relay-' + 'e'.repeat(64);
function preview(operation = 'upload', source = 'local') {
  return {
    schema_version: 1,
    preview_id: 'b'.repeat(64),
    context_id: ctx,
    source_id: source,
    destination_id: 'sync-relay',
    purpose_id: 'sync-object-v1',
    retention_id: 'ciphertext-only',
    retention_disclosure: 'Ciphertext only',
    policy_version: '18446744073709551615',
    vault_id: id,
    key_epoch: '18446744073709551615',
    operation,
    snapshot_id: ['list', 'cleanup_list'].includes(operation) ? null : id,
    bundle_sha256: ['list', 'cleanup_list'].includes(operation) ? null : 'a'.repeat(64),
    object_count: ['list', 'cleanup_list'].includes(operation) ? 0 : 1,
    expires_at: '2099-01-01T00:00:00Z',
  };
}
async function providerReady() {
  const s = useBackupStore();
  get.mockImplementation(async (path: string) => ({
    data: JSON.stringify(
      path === '/0/egress/status'
        ? { outbound_enabled: true, kill_switch_enabled: false, trusted_policy_keys: 1 }
        : path === '/0/entitlements/'
        ? { sync_allowed: true }
        : {
            purposes: [{ id: 'sync-object-v1', destination_id: 'sync-relay' }],
            destinations: [{ id: 'sync-relay', status: 'available' }],
          }
    ),
  }));
  await s.refreshProvider();
  return s;
}
test('selected upload has explicit reviewed approval and finite partial result without replay', async () => {
  const s = await providerReady();
  await s.load();
  s.select(s.versions[0]);
  post.mockResolvedValueOnce({ data: JSON.stringify(preview()) });
  await s.reviewProvider('upload', 'sync-relay');
  expect(post).toHaveBeenCalledTimes(1);
  await s.runProvider(false);
  expect(post).toHaveBeenCalledTimes(1);
  post
    .mockResolvedValueOnce({
      data: JSON.stringify({ schema_version: 1, context_id: ctx, job_id: 'f'.repeat(64) }),
    })
    .mockResolvedValueOnce({
      data: JSON.stringify({
        schema_version: 1,
        context_id: ctx,
        status: 'partial',
        completed_objects: 0,
        object_count: 1,
        local_selection: null,
      }),
    });
  await s.runProvider(true);
  expect(s.transfer?.status).toBe('partial');
  expect(s.providerPreview).toBeNull();
  expect(post.mock.calls.map(c => c[0])).toEqual([
    '/0/sync/backups/preview',
    '/0/sync/backups/approve',
    '/0/sync/backups/run',
  ]);
  await s.runProvider(true);
  expect(post).toHaveBeenCalledTimes(3);
  expect(post.mock.calls[0][1].source_json).toContain('"key_epoch":"18446744073709551615"');
});
test('provider download keeps ciphertext out of JS and yields the exact local selection', async () => {
  const s = await providerReady();
  post.mockResolvedValueOnce({ data: JSON.stringify(preview('list', remoteSource)) });
  await s.reviewProvider('list', 'sync-relay');
  const remoteRow = { ...row(), selection: { ...selection(), source_id: remoteSource } };
  post
    .mockResolvedValueOnce({
      data: JSON.stringify({ schema_version: 1, context_id: ctx, job_id: 'f'.repeat(64) }),
    })
    .mockResolvedValueOnce({
      data: JSON.stringify({ ...catalogue([remoteRow]), source_id: remoteSource }),
    });
  await s.runProvider(true);
  s.select(s.versions[0]);
  post.mockResolvedValueOnce({ data: JSON.stringify(preview('download', remoteSource)) });
  await s.reviewProvider('download', 'sync-relay');
  const request = post.mock.calls[3][1];
  expect(JSON.parse(request.source_json).selection).toBeUndefined();
  expect(request.selection.source_id).toBe(remoteSource);
  post
    .mockResolvedValueOnce({
      data: JSON.stringify({ schema_version: 1, context_id: ctx, job_id: 'f'.repeat(64) }),
    })
    .mockResolvedValueOnce({
      data: JSON.stringify({
        schema_version: 1,
        context_id: ctx,
        status: 'complete',
        completed_objects: 1,
        object_count: 1,
        local_selection: selection(),
      }),
    });
  await s.runProvider(true);
  expect(s.selected?.source_id).toBe('local');
  expect(s.exportRaw).toBe('');
  expect(s.transfer?.status).toBe('complete');
});
test('context invalidation while provider approve waits prevents any run', async () => {
  const s = await providerReady();
  await s.load();
  s.select(s.versions[0]);
  post.mockResolvedValueOnce({ data: JSON.stringify(preview()) });
  await s.reviewProvider('upload', 'sync-relay');
  const pending = defer();
  post.mockReturnValueOnce(pending.promise);
  const work = s.runProvider(true);
  await Promise.resolve();
  await Promise.resolve();
  s.clearSensitive();
  pending.resolve({
    data: JSON.stringify({ schema_version: 1, context_id: ctx, job_id: 'f'.repeat(64) }),
  });
  await work;
  expect(post.mock.calls.some(c => c[0].endsWith('/run'))).toBe(false);
  expect(s.providerPreview).toBeNull();
  expect(s.transfer).toBeNull();
});
test('native context failure erases the kit and phrase', async () => {
  const s = useBackupStore();
  s.configure({ mode: 'local', folderPath: '', kitRaw: '{}', phrase: 'private' });
  invoke.mockRejectedValue(new Error('private phrase should never be shown'));
  await s.load();
  expect(s.phrase).toBe('');
  expect(s.kitRaw).toBe('');
  expect(s.error).not.toContain('private phrase');
});
test.each([
  'rotate_sync_keys',
  'revoke_sync_device',
  'accept_sync_key_transfer',
  'restore_sync_recovery_kit',
  'create_sync_recovery_kit',
  'create_current_sync_snapshot',
])('key/source mutation %s clears owned backup inputs before native work', async command => {
  const { useSyncStore } = await import('~/stores/sync');
  const s = useBackupStore();
  s.configure({ mode: 'local', folderPath: '', kitRaw: '{}', phrase: 'private' });
  const pending = defer();
  invoke.mockReturnValue(pending.promise);
  const work = useSyncStore().run(command);
  expect(s.kitRaw).toBe('');
  expect(s.phrase).toBe('');
  pending.resolve(null);
  await work;
});

test('local deletion requires fresh review and acceptance, retains only deletion retry authority', async () => {
  invoke.mockImplementation(async c =>
    c === 'get_sync_backup_context'
      ? { schema_version: 1, context_id: ctx }
      : c === 'list_sync_backups'
      ? catalogue([{ ...row(), current: false, deletion_selection: selection() }])
      : c === 'preview_sync_backup_delete'
      ? {
          schema_version: 1,
          context_id: ctx,
          selection: selection(),
          object_count: 1,
          retry: false,
          copy_scope: 'local',
        }
      : {
          schema_version: 1,
          context_id: ctx,
          selection: selection(),
          copy_scope: 'local',
          deleted: 1,
          absent: 0,
          conflict: 0,
          failed: 0,
          durable: true,
        }
  );
  const s = useBackupStore();
  await s.load();
  s.selectDeletion(s.versions[0]);
  await s.deleteSelected(true);
  expect(invoke.mock.calls.some(c => c[0] === 'delete_selected_sync_backup')).toBe(false);
  await s.previewDelete();
  await s.deleteSelected(false);
  expect(invoke.mock.calls.some(c => c[0] === 'delete_selected_sync_backup')).toBe(false);
  await s.deleteSelected(true);
  expect(s.deleteOutcome.deleted).toBe(1);
  expect(s.selected).toBeNull();
  expect(s.deletePreview).toBeNull();
  expect(s.deletionSelected.snapshot_id).toBe(id);
  await s.deleteSelected(true);
  expect(invoke.mock.calls.filter(c => c[0] === 'delete_selected_sync_backup')).toHaveLength(1);
  s.clearSensitive();
  expect(s.deletionSelected).toBeNull();
  expect(s.deleteOutcome).toBeNull();
});

test.each(['clear', 'dispose', 'source'])(
  'late delete preview cannot publish after %s',
  async what => {
    const s = useBackupStore();
    invoke.mockImplementation(async c =>
      c === 'get_sync_backup_context'
        ? { schema_version: 1, context_id: ctx }
        : catalogue([{ ...row(), current: false, deletion_selection: selection() }])
    );
    await s.load();
    s.selectDeletion(s.versions[0]);
    const pending = defer();
    invoke.mockImplementation(async c =>
      c === 'get_sync_backup_context' ? { schema_version: 1, context_id: ctx } : pending.promise
    );
    const work = s.previewDelete();
    await Promise.resolve();
    await Promise.resolve();
    if (what === 'dispose') s.$dispose();
    else if (what === 'clear') s.clearSensitive();
    else s.configure({ mode: 'folder', folderPath: '/different', kitRaw: '', phrase: '' });
    pending.resolve({
      schema_version: 1,
      context_id: ctx,
      selection: selection(),
      object_count: 1,
      retry: false,
      copy_scope: 'local',
    });
    await work;
    expect(s.deletePreview).toBeNull();
    expect(s.deletionSelected).toBeNull();
  }
);

test('free cleanup availability survives missing paid entitlement and cannot enable transfer', async () => {
  const s = useBackupStore();
  get.mockImplementation(async path => {
    if (path === '/0/entitlements/') throw new Error('unavailable');
    return {
      data: JSON.stringify(
        path === '/0/egress/status'
          ? { outbound_enabled: true, kill_switch_enabled: false, trusted_policy_keys: 1 }
          : {
              purposes: [{ id: 'sync-object-v1', destination_id: 'sync-relay' }],
              destinations: [{ id: 'sync-relay', status: 'available' }],
            }
      ),
    };
  });
  await s.refreshProvider();
  expect(s.cleanupAllowed).toBe(true);
  expect(s.providerAllowed).toBe(false);
  post.mockResolvedValueOnce({ data: JSON.stringify(preview('cleanup_list', remoteSource)) });
  await s.reviewProvider('cleanup_list', 'sync-relay');
  expect(s.providerPreview.operation).toBe('cleanup_list');
  s.clearSensitive();
  expect(s.cleanupAllowed).toBe(false);
});

test.each(['key_epoch', 'vault_id', 'object_count'])(
  'provider delete outcome rejects changed %s',
  async field => {
    const s = await providerReady();
    const remote = { ...selection(), source_id: remoteSource };
    invoke.mockImplementation(async c =>
      c === 'get_sync_backup_context'
        ? { schema_version: 1, context_id: ctx }
        : {
            ...catalogue([{ ...row(), selection: null, deletion_selection: remote }]),
            source_id: remoteSource,
            cleanup_only: true,
          }
    );
    await s.load();
    s.selectDeletion(s.versions[0]);
    post.mockResolvedValueOnce({ data: JSON.stringify(preview('delete', remoteSource)) });
    await s.reviewProvider('delete', 'sync-relay');
    const altered = {
      ...remote,
      [field]: field === 'key_epoch' ? '1' : field === 'vault_id' ? 'AQEBAQEBAQEBAQEBAQEBAQ' : 2,
    };
    post
      .mockResolvedValueOnce({
        data: JSON.stringify({ schema_version: 1, context_id: ctx, job_id: 'f'.repeat(64) }),
      })
      .mockResolvedValueOnce({
        data: JSON.stringify({
          schema_version: 1,
          context_id: ctx,
          selection: altered,
          copy_scope: 'provider',
          deleted: 0,
          absent: altered.object_count,
          conflict: 0,
          failed: 0,
          unknown: 0,
          durable: false,
        }),
      });
    await s.runProvider(true);
    expect(s.deleteOutcome).toBeNull();
    expect(s.error).toBeTruthy();
  }
);

test('new provider discovery clears a previous deletion-only reference', async () => {
  const s = await providerReady();
  await s.load();
  s.deletionSelected = { ...selection(), source_id: remoteSource };
  post.mockResolvedValueOnce({ data: JSON.stringify(preview('cleanup_list', remoteSource)) });
  await s.reviewProvider('cleanup_list', 'sync-relay');
  post
    .mockResolvedValueOnce({
      data: JSON.stringify({ schema_version: 1, context_id: ctx, job_id: 'f'.repeat(64) }),
    })
    .mockResolvedValueOnce({
      data: JSON.stringify({ ...catalogue([]), source_id: remoteSource, cleanup_only: true }),
    });
  await s.runProvider(true);
  expect(s.deletionSelected).toBeNull();
});
