import {
  backupCatalogue,
  backupSelection,
  backupProviderPreview,
  backupRestorePreview,
  backupDeleteOutcome,
  backupDeletePreview,
} from '~/util/backupContracts';
const id = 'AAAAAAAAAAAAAAAAAAAAAA';
const selected = {
  schema_version: 1,
  source_id: 'local',
  vault_id: id,
  key_epoch: '18446744073709551615',
  snapshot_id: id,
  object_count: 1,
  bundle_sha256: 'a'.repeat(64),
};
test.each([0, 1, 18446744073709551616, '18446744073709551616', '01'])(
  'closed selection rejects invalid/rounded epoch %s',
  key_epoch => expect(() => backupSelection({ ...selected, key_epoch })).toThrow()
);
test('full-u64 selected reference is frozen and unexpected authority fields rejected', () => {
  expect(backupSelection(selected).key_epoch).toBe('18446744073709551615');
  expect(Object.isFrozen(backupSelection(selected))).toBe(true);
  expect(() => backupSelection({ ...selected, url: 'https://untrusted' })).toThrow();
});
test('raw restore epoch remains full width and duplicate fields reject', () => {
  const raw =
    '{"schema_version":1,"vault_id":"' +
    id +
    '","snapshot_id":"' +
    id +
    '","key_epoch":18446744073709551615,"object_count":1,"policy_continuity_present":false,"policy_conflict_count":0,"query_start":null,"query_end":null}';
  expect(backupRestorePreview(raw).key_epoch).toBe('18446744073709551615');
  expect(() =>
    backupRestorePreview(raw.replace('"object_count":1', '"object_count":1,"object_count":1'))
  ).toThrow();
});
test('unverified rows cannot advertise payload contents or selection', () => {
  const row = {
    snapshot_id: id,
    key_epoch: '1',
    object_count: 1,
    declared_object_count: 2,
    status: 'incomplete',
    selection: null,
    event_count: null,
    query_start: null,
    query_end: null,
    policy_continuity_present: null,
  };
  const page = {
    schema_version: 1,
    source_id: 'local',
    context_id: 'c'.repeat(64),
    vault_id: id,
    key_epoch: '1',
    requires_recovery_kit: false,
    namespaces: [],
    versions: [row],
    invalid_object_count: 0,
    operation_object_count: 0,
  };
  expect(backupCatalogue(page).versions[0].selection).toBeNull();
  expect(() => backupCatalogue({ ...page, versions: [{ ...row, event_count: 1 }] })).toThrow();
  expect(() => backupCatalogue({ ...page, versions: [{ ...row, selection: selected }] })).toThrow();
});
test('provider preview rejects unexpected operation and ambiguous JSON', () => {
  expect(() =>
    backupProviderPreview('{"schema_version":1,"schema_version":1}', 'c'.repeat(64))
  ).toThrow();
  expect(() => backupProviderPreview('{}', 'c'.repeat(64))).toThrow();
});

test('cleanup catalogue exposes deletion authority separately and preserves forgotten summary', () => {
  const reference = { ...selected, source_id: 'relay-' + 'a'.repeat(64) };
  const row = {
    snapshot_id: id,
    key_epoch: selected.key_epoch,
    object_count: 1,
    declared_object_count: 1,
    status: 'forgotten',
    current: false,
    selection: null,
    deletion_selection: reference,
    event_count: 2,
    query_start: null,
    query_end: null,
    policy_continuity_present: true,
  };
  const page = {
    schema_version: 1,
    context_id: 'c'.repeat(64),
    source_id: reference.source_id,
    vault_id: id,
    key_epoch: selected.key_epoch,
    requires_recovery_kit: false,
    cleanup_only: true,
    namespaces: [],
    versions: [row],
    invalid_object_count: 0,
    operation_object_count: 0,
  };
  expect(backupCatalogue(page).versions[0].deletion_selection).toEqual(reference);
  expect(() =>
    backupCatalogue({ ...page, versions: [{ ...row, selection: reference }] })
  ).toThrow();
  expect(() => backupCatalogue({ ...page, versions: [{ ...row, current: true }] })).toThrow();
});

test('deletion result counts are finite and bound to the reviewed copy', () => {
  const outcome = {
    schema_version: 1,
    context_id: 'c'.repeat(64),
    selection: selected,
    copy_scope: 'provider',
    deleted: 0,
    absent: 0,
    conflict: 0,
    failed: 0,
    unknown: 1,
    durable: false,
  };
  expect(backupDeleteOutcome(outcome, 'c'.repeat(64)).unknown).toBe(1);
  expect(() => backupDeleteOutcome({ ...outcome, deleted: 1 }, 'c'.repeat(64))).toThrow();
  expect(() => backupDeleteOutcome({ ...outcome, unknown: -1 }, 'c'.repeat(64))).toThrow();
  expect(() => backupDeleteOutcome(outcome, 'd'.repeat(64))).toThrow();
  const preview = {
    schema_version: 1,
    context_id: 'c'.repeat(64),
    selection: selected,
    object_count: 1,
    retry: true,
    copy_scope: 'local',
  };
  expect(backupDeletePreview(preview, 'c'.repeat(64)).retry).toBe(true);
  expect(() => backupDeletePreview({ ...preview, object_count: 2 }, 'c'.repeat(64))).toThrow();
});

test('deletion response records are closed and summary does not mint unknown authority', () => {
  const outcome = {
    schema_version: 1,
    context_id: 'c'.repeat(64),
    selection: selected,
    copy_scope: 'local',
    deleted: 1,
    absent: 0,
    conflict: 0,
    failed: 0,
    durable: true,
  };
  expect(() =>
    backupDeleteOutcome({ ...outcome, arbitrary_ids: ['opaque'] }, 'c'.repeat(64))
  ).toThrow();
  const review = {
    schema_version: 1,
    context_id: 'c'.repeat(64),
    selection: selected,
    object_count: 1,
    retry: false,
    copy_scope: 'local',
  };
  expect(() => backupDeletePreview({ ...review, authority: true }, 'c'.repeat(64))).toThrow();
});
