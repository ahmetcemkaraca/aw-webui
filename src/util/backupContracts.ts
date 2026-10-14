import { strictJson } from './strictJson';
export interface BackupSelection {
  schema_version: 1;
  source_id: string;
  vault_id: string;
  key_epoch: string;
  snapshot_id: string;
  object_count: number;
  bundle_sha256: string;
}
export interface BackupVersion {
  snapshot_id: string;
  key_epoch: string;
  object_count: number;
  observed_object_count: number;
  declared_object_count: number | null;
  status: 'authenticated' | 'incomplete' | 'invalid_recovery' | 'forgotten';
  current: boolean;
  deletion_selection: BackupSelection | null;
  selection: BackupSelection | null;
  event_count: number | null;
  query_start: string | null;
  query_end: string | null;
  policy_continuity_present: boolean | null;
}
const assert = (value: unknown) => {
  if (!value) throw new Error('Invalid backup response.');
};
const object = (v: any) => assert(v && typeof v === 'object' && !Array.isArray(v));
const hex = (v: any) => assert(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v));
const id = (v: any) => assert(typeof v === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(v));
const uint = (v: any, max = 100000) => assert(Number.isSafeInteger(v) && v >= 0 && v <= max);
const epoch = (v: any) =>
  assert(
    typeof v === 'string' &&
      /^[1-9]\d*$/.test(v) &&
      (v.length < 20 || (v.length === 20 && v <= '18446744073709551615'))
  );
const source = (v: any) =>
  assert(typeof v === 'string' && /^(local|folder-[a-f0-9]{64}|relay-[a-f0-9]{64})$/.test(v));
export function backupSelection(v: any): BackupSelection {
  object(v);
  assert(v.schema_version === 1);
  assert(
    Object.keys(v).length === 7 &&
      [
        'schema_version',
        'source_id',
        'vault_id',
        'key_epoch',
        'snapshot_id',
        'object_count',
        'bundle_sha256',
      ].every(k => Object.prototype.hasOwnProperty.call(v, k))
  );
  source(v.source_id);
  id(v.vault_id);
  id(v.snapshot_id);
  epoch(v.key_epoch);
  hex(v.bundle_sha256);
  uint(v.object_count);
  assert(v.object_count > 0);
  return Object.freeze({ ...v });
}
export function backupCatalogue(v: any) {
  object(v);
  assert(v.schema_version === 1);
  hex(v.context_id);
  source(v.source_id);
  assert(
    typeof v.requires_recovery_kit === 'boolean' &&
      Array.isArray(v.namespaces) &&
      v.namespaces.length <= 100000 &&
      Array.isArray(v.versions) &&
      v.versions.length <= 100000
  );
  if (v.requires_recovery_kit)
    assert(v.vault_id === null && v.key_epoch === null && v.versions.length === 0);
  else {
    id(v.vault_id);
    epoch(v.key_epoch);
  }
  assert(v.cleanup_only === undefined || typeof v.cleanup_only === 'boolean');
  v.namespaces.forEach((ns: any) => {
    object(ns);
    id(ns.vault_id);
    epoch(ns.key_epoch);
    uint(ns.object_count, Number.MAX_SAFE_INTEGER);
  });
  uint(v.invalid_object_count);
  uint(v.operation_object_count);
  const versions: BackupVersion[] = v.versions.map((row: any) => {
    object(row);
    id(row.snapshot_id);
    epoch(row.key_epoch);
    uint(row.object_count);
    const observed =
      row.observed_object_count === undefined ? row.object_count : row.observed_object_count;
    uint(observed);
    assert(observed <= row.object_count);
    if (row.declared_object_count !== null) uint(row.declared_object_count, 4294967295);
    assert(['authenticated', 'incomplete', 'invalid_recovery', 'forgotten'].includes(row.status));
    const current = row.current === undefined ? false : row.current;
    assert(typeof current === 'boolean');
    const deletion =
      row.deletion_selection == null ? null : backupSelection(row.deletion_selection);
    const selected = row.selection === null ? null : backupSelection(row.selection);
    assert((row.status === 'authenticated' && v.cleanup_only !== true) === !!selected);
    assert(!deletion || (!current && ['authenticated', 'forgotten'].includes(row.status)));
    assert(v.cleanup_only !== true || selected === null);
    for (const reference of [selected, deletion])
      if (reference)
        assert(
          reference.source_id === v.source_id &&
            reference.snapshot_id === row.snapshot_id &&
            reference.key_epoch === row.key_epoch &&
            reference.object_count === row.object_count &&
            reference.vault_id === v.vault_id
        );
    for (const key of ['query_start', 'query_end'])
      assert(
        row[key] === null ||
          (typeof row[key] === 'string' &&
            row[key].length <= 64 &&
            Number.isFinite(Date.parse(row[key])))
      );
    if (row.event_count !== null) uint(row.event_count, Number.MAX_SAFE_INTEGER);
    assert(
      row.policy_continuity_present === null || typeof row.policy_continuity_present === 'boolean'
    );
    if (!['authenticated', 'forgotten'].includes(row.status))
      assert(
        row.event_count === null &&
          row.query_start === null &&
          row.query_end === null &&
          row.policy_continuity_present === null
      );
    return Object.freeze({
      ...row,
      current,
      observed_object_count: observed,
      selection: selected,
      deletion_selection: deletion,
    });
  });
  return { ...v, versions };
}
export function backupProviderPreview(raw: string, context: string) {
  const v = strictJson(raw, 128 * 1024).value;
  object(v);
  assert(v.schema_version === 1 && v.context_id === context);
  hex(v.preview_id);
  source(v.source_id);
  id(v.vault_id);
  epoch(v.key_epoch);
  epoch(v.policy_version);
  assert(['list', 'cleanup_list', 'delete', 'upload', 'download'].includes(v.operation));
  uint(v.object_count);
  assert(typeof v.destination_id === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(v.destination_id));
  assert(
    v.purpose_id === 'sync-object-v1' &&
      typeof v.retention_id === 'string' &&
      v.retention_id.length <= 128 &&
      typeof v.retention_disclosure === 'string' &&
      v.retention_disclosure.length <= 4096
  );
  assert(typeof v.expires_at === 'string' && Number.isFinite(Date.parse(v.expires_at)));
  if (!['list', 'cleanup_list'].includes(v.operation)) {
    id(v.snapshot_id);
    hex(v.bundle_sha256);
    assert(v.object_count > 0);
  } else assert(v.snapshot_id === null && v.bundle_sha256 === null && v.object_count === 0);
  return Object.freeze(v);
}
export function backupRestorePreview(raw: string) {
  const parsed = strictJson(raw, 128 * 1024, { captureSource: true });
  const v = parsed.value;
  object(v);
  assert(v.schema_version === 1);
  id(v.vault_id);
  id(v.snapshot_id);
  uint(v.object_count);
  const keyEpoch = parsed.numberTokens?.get(v)?.get('key_epoch');
  epoch(keyEpoch);
  assert(typeof v.policy_continuity_present === 'boolean');
  uint(v.policy_conflict_count, Number.MAX_SAFE_INTEGER);
  for (const key of ['query_start', 'query_end'])
    assert(v[key] === null || (typeof v[key] === 'string' && Number.isFinite(Date.parse(v[key]))));
  return Object.freeze({ ...v, key_epoch: keyEpoch });
}

function closed(v: any, keys: string[]) {
  assert(Object.keys(v).every(key => keys.includes(key)));
}
export function backupDeletePreview(v: any, context: string) {
  object(v);
  closed(v, ['schema_version', 'context_id', 'selection', 'object_count', 'retry', 'copy_scope']);
  assert(v.schema_version === 1 && v.context_id === context);
  const selection = backupSelection(v.selection);
  assert(v.object_count === selection.object_count && typeof v.retry === 'boolean');
  assert(['local', 'folder'].includes(v.copy_scope));
  return Object.freeze({ ...v, selection });
}
export function backupDeleteOutcome(v: any, context: string) {
  object(v);
  closed(v, [
    'schema_version',
    'context_id',
    'selection',
    'copy_scope',
    'deleted',
    'absent',
    'conflict',
    'failed',
    'unknown',
    'durable',
  ]);
  assert(v.schema_version === 1 && v.context_id === context);
  const selection = backupSelection(v.selection);
  assert(['local', 'folder', 'provider'].includes(v.copy_scope));
  for (const key of ['deleted', 'absent', 'conflict', 'failed']) uint(v[key]);
  const unknown = v.unknown === undefined ? 0 : v.unknown;
  uint(unknown);
  assert(v.deleted + v.absent + v.conflict + v.failed + unknown === selection.object_count);
  assert(typeof v.durable === 'boolean');
  return Object.freeze({ ...v, selection, unknown });
}
