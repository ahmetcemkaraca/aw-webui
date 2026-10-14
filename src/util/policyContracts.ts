import { strictJson, utf8Bytes } from './strictJson';

export const POLICY_FIELDS = [
  'settings.startOfDay',
  'settings.startOfWeek',
  'settings.durationDefault',
  'settings.useColorFallback',
  'settings.landingpage',
  'settings.theme',
  'settings.always_active_pattern',
  'settings.privacy_filters',
  'settings.classes',
  'settings.category_sets',
  'settings.active_set_ids',
  'settings.views',
  'settings.saved_queries',
  'settings.ignoredCategorySuggestions',
  'settings.showYearly',
  'settings.useMultidevice',
  'settings.rawRetentionDays',
  'settings.uncategorizedNotificationData',
  'capture.minimization',
  'egress.user_policy',
  'egress.signed_bundle',
] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];
export type PolicyDecision = 'keep-local' | 'accept-remote';
export interface PolicyCandidate {
  readonly candidate_id: string;
  readonly field: PolicyField;
  readonly device_id: string;
  readonly counter: string;
  readonly policy_version: string;
  readonly recovery_source?: {
    readonly schema_version: 1;
    readonly vault_id: string;
    readonly key_epoch: string;
    readonly snapshot_id: string;
  };
}
export interface PolicyValue {
  readonly schema_version: 1;
  readonly present: boolean;
  readonly value: unknown;
}
export interface PolicyPreview {
  readonly policy: {
    readonly schema_version: 1;
    readonly candidate: PolicyCandidate;
    readonly current: PolicyValue;
    readonly proposed: PolicyValue;
    readonly expected_review_sha256: string;
  };
  readonly accept_remote_available: boolean;
  readonly reason: null | 'firewall-review-unavailable';
  readonly currentRaw: string;
  readonly proposedRaw: string;
  readonly firewallRaw: string;
}
export interface PolicyPage {
  schema_version: 1;
  candidates: PolicyCandidate[];
  next_cursor: string | null;
}
export interface PolicyChoiceResult {
  schema_version: 1;
  field: PolicyField;
  decision: PolicyDecision;
  applied: boolean;
}
const MAX_BYTES = 4 * 1024 * 1024;
const U64_MAX = '18446744073709551615';
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function requirePolicy(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid policy review response');
}
function object(value: any): asserts value is Record<string, any> {
  requirePolicy(value && typeof value === 'object' && !Array.isArray(value));
}
function record(value: any, required: string[], optional: string[] = []) {
  object(value);
  requirePolicy(
    required.every(key => own(value, key)) &&
      Object.keys(value).every(key => required.includes(key) || optional.includes(key))
  );
}
function text(value: any, max = MAX_BYTES, nonempty = false) {
  requirePolicy(
    typeof value === 'string' && utf8Bytes(value) <= max && (!nonempty || value.length > 0)
  );
}
function boolean(value: any) {
  requirePolicy(typeof value === 'boolean');
}
function array(value: any, check: (item: any, index: number) => void, max = MAX_BYTES) {
  requirePolicy(Array.isArray(value) && value.length <= max);
  value.forEach(check);
}
function strings(value: any) {
  array(value, item => text(item));
}
function hex(value: any) {
  requirePolicy(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
function u64Text(value: any, positive = false) {
  requirePolicy(
    typeof value === 'string' &&
      /^(0|[1-9]\d*)$/.test(value) &&
      value.length <= 20 &&
      (value.length < 20 || value <= U64_MAX) &&
      (!positive || value !== '0')
  );
}
function field(value: any): asserts value is PolicyField {
  requirePolicy(POLICY_FIELDS.includes(value));
}
function finite(value: any) {
  requirePolicy(typeof value === 'number' && Number.isFinite(value));
}
function noControls(value: string) {
  requirePolicy(!/\p{Cc}/u.test(value));
}
function identifier(value: any) {
  requirePolicy(typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(value));
}
function candidate(value: any, parsed: Parsed) {
  record(value, ['candidate_id', 'field', 'device_id', 'counter', 'policy_version'], ['recovery_source']);
  hex(value.candidate_id);
  field(value.field);
  requirePolicy(
    typeof value.device_id === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(value.device_id)
  );
  u64Text(value.counter, true);
  u64Text(value.policy_version, true);
  if (own(value,'recovery_source')) {
    const source = value.recovery_source;
    record(source,['schema_version','vault_id','key_epoch','snapshot_id']);schema(source,parsed);
    for (const key of ['vault_id','snapshot_id']) requirePolicy(typeof source[key] === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(source[key]));
    u64Text(source.key_epoch,true);
    requirePolicy(source.snapshot_id === value.device_id && source.key_epoch === value.policy_version && value.counter === '1');
    Object.freeze(source);
  }
}
function decoded(raw: string) {
  return strictJson(raw, MAX_BYTES, { maxDepth: 256, maxValues: MAX_BYTES, captureSource: true });
}
type Parsed = ReturnType<typeof decoded>;
function schema(value: any, parsed: Parsed) {
  requirePolicy(value.schema_version === 1 && parsed.integers.get(value)?.has('schema_version'));
}
function smallUint(value: any, key: string, parsed: Parsed, max: number, min = 0) {
  requirePolicy(
    parsed.integers.get(value)?.has(key) &&
      Number.isSafeInteger(value[key]) &&
      value[key] >= min &&
      value[key] <= max
  );
}
function u64(value: any, key: string, parsed: Parsed, positive = false) {
  requirePolicy(typeof value[key] === 'number');
  u64Text(parsed.numberTokens?.get(value)?.get(key), positive);
}
function rawProperty(raw: string, parsed: Parsed, value: object, key: string) {
  const span = parsed.propertySpans?.get(value)?.get(key);
  requirePolicy(span);
  return raw.slice(span[0], span[1]).trim();
}
// Portable legacy structs may use Serde positional sequences; normalized Firewall replies use objects.
function nativeRecord(
  value: any,
  order: string[],
  optional: string[],
  parsed: Parsed,
  portable = false
): any {
  if (portable && Array.isArray(value)) {
    requirePolicy(
      value.length <= order.length &&
        order.every((key, i) => i < value.length || optional.includes(key))
    );
    const mapped = Object.create(null),
      numeric = new Set<string>(),
      tokens = new Map<string, string>();
    order.forEach((key, i) => {
      if (i < value.length) {
        mapped[key] = value[i];
        if (parsed.integers.get(value)?.has(String(i))) numeric.add(key);
        const token = parsed.numberTokens?.get(value)?.get(String(i));
        if (token !== undefined) tokens.set(key, token);
      }
    });
    parsed.integers.set(mapped, numeric);
    parsed.numberTokens?.set(mapped, tokens);
    value = mapped;
  }
  record(
    value,
    order.filter(key => !optional.includes(key)),
    optional
  );
  return value;
}
function pattern(value: any, parsed: Parsed, portable = false) {
  value = nativeRecord(value, ['kind', 'value'], [], parsed, portable);
  requirePolicy(['field', 'application', 'domain', 'keyword'].includes(value.kind));
  text(value.value, 256, true);
  noControls(value.value);
}
function rule(value: any, parsed: Parsed, portable = false) {
  value = nativeRecord(value, ['pattern', 'action'], [], parsed, portable);
  pattern(value.pattern, parsed, portable);
  requirePolicy(
    ['deny', 'drop_field', 'redact_value', 'domain_only', 'stable_alias'].includes(value.action)
  );
}
function schedule(value: any, parsed: Parsed, portable = false) {
  if (value === null || value === undefined) return;
  value = nativeRecord(value, ['weekdays', 'start_minute', 'end_minute'], [], parsed, portable);
  array(value.weekdays, (_, i) => smallUint(value.weekdays, String(i), parsed, 7, 1), 7);
  requirePolicy(
    value.weekdays.length > 0 && new Set(value.weekdays).size === value.weekdays.length
  );
  smallUint(value, 'start_minute', parsed, 1439);
  smallUint(value, 'end_minute', parsed, 1439);
  requirePolicy(value.start_minute !== value.end_minute);
}
function destination(value: any, parsed: Parsed, portable = false) {
  value = nativeRecord(
    value,
    ['id', 'status', 'https_origin', 'allowed_purposes'],
    portable ? ['https_origin'] : [],
    parsed,
    portable
  );
  identifier(value.id);
  requirePolicy(
    ['available', 'beta', 'experimental', 'planned', 'unsupported'].includes(value.status)
  );
  if (own(value, 'https_origin') && value.https_origin !== null) text(value.https_origin);
  array(value.allowed_purposes, item => identifier(item));
}
function purpose(value: any, parsed: Parsed, portable = false) {
  value = nativeRecord(
    value,
    [
      'id',
      'destination_id',
      'endpoint_path',
      'retention_id',
      'retention_disclosure',
      'allowed_fields',
    ],
    [],
    parsed,
    portable
  );
  identifier(value.id);
  identifier(value.destination_id);
  identifier(value.retention_id);
  text(value.endpoint_path);
  text(value.retention_disclosure, 1024, true);
  strings(value.allowed_fields);
}
function userPolicy(value: any, parsed: Parsed) {
  record(value, ['schema_version', 'user_rules', 'safe_zone_patterns'], ['after_hours']);
  schema(value, parsed);
  array(value.user_rules, item => rule(item, parsed, true));
  array(value.safe_zone_patterns, item => pattern(item, parsed, true));
  schedule(value.after_hours, parsed, true);
}
function signedBundle(value: any, parsed: Parsed) {
  record(value, ['schema_version', 'signer_key_id', 'bundle', 'signature']);
  schema(value, parsed);
  text(value.signer_key_id, MAX_BYTES, true);
  noControls(value.signer_key_id);
  record(value.bundle, [
    'schema_version',
    'version',
    'hard_deny_version',
    'destinations',
    'purposes',
    'organization_rules',
  ]);
  schema(value.bundle, parsed);
  u64(value.bundle, 'version', parsed, true);
  u64(value.bundle, 'hard_deny_version', parsed, true);
  array(value.bundle.destinations, item => destination(item, parsed, true));
  array(value.bundle.purposes, item => purpose(item, parsed, true));
  array(value.bundle.organization_rules, item => rule(item, parsed, true));
  array(value.signature, (_, i) => smallUint(value.signature, String(i), parsed, 255), 64);
  requirePolicy(value.signature.length === 64);
}
function categories(value: any) {
  array(value, item => {
    object(item);
    strings(item.name);
    object(item.rule);
    if (own(item, 'data') && item.data !== null) object(item.data);
    const type = item.rule.type;
    requirePolicy(type === undefined || type === null || type === 'none' || type === 'regex');
    if (type === 'regex') {
      text(item.rule.regex);
      if (own(item.rule, 'ignore_case')) boolean(item.rule.ignore_case);
      if (own(item.rule, 'select_keys')) {
        strings(item.rule.select_keys);
        requirePolicy(item.rule.select_keys.length > 0);
      }
    }
  });
}
const VIEW_TYPES = [
  'top_apps',
  'top_titles',
  'top_domains',
  'top_urls',
  'top_browser_titles',
  'top_editor_files',
  'top_editor_languages',
  'top_editor_projects',
  'top_categories',
  'category_tree',
  'category_sunburst',
  'timeline_barchart',
  'sunburst_clock',
  'vis_timeline',
  'custom_vis',
  'score',
  'top_stopwatches',
  'top_bucket_data',
];
function payload(scope: PolicyField, value: any, parsed: Parsed) {
  switch (scope) {
    case 'settings.startOfDay':
      requirePolicy(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
      break;
    case 'settings.startOfWeek':
      requirePolicy(['Saturday', 'Sunday', 'Monday'].includes(value));
      break;
    case 'settings.durationDefault': {
      const number =
        typeof value === 'string' &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
          ? Number(value.trim())
          : value;
      finite(number);
      requirePolicy(number > 0);
      break;
    }
    case 'settings.useColorFallback':
    case 'settings.showYearly':
    case 'settings.useMultidevice':
      boolean(value);
      break;
    case 'settings.landingpage':
      text(value);
      requirePolicy(value.startsWith('/') && !value.startsWith('//'));
      noControls(value);
      break;
    case 'settings.theme':
      requirePolicy(['auto', 'light', 'dark'].includes(value));
      break;
    case 'settings.always_active_pattern':
      text(value);
      break;
    case 'settings.classes':
      if (value !== null) categories(value);
      break;
    case 'settings.category_sets':
      if (value !== null)
        array(value, item => {
          object(item);
          text(item.id);
          categories(item.categories);
        });
      break;
    case 'settings.active_set_ids':
      if (value !== null) strings(value);
      break;
    case 'settings.ignoredCategorySuggestions':
      strings(value);
      break;
    case 'settings.rawRetentionDays':
      finite(value);
      requirePolicy(Number.isInteger(value) && value >= 0 && value <= 3650);
      break;
    case 'settings.uncategorizedNotificationData':
      record(value, ['isEnabled', 'minTotalSeconds', 'minRatio']);
      boolean(value.isEnabled);
      finite(value.minTotalSeconds);
      finite(value.minRatio);
      requirePolicy(value.minTotalSeconds >= 0 && value.minRatio >= 0 && value.minRatio <= 1);
      break;
    case 'settings.saved_queries':
      array(value, item => {
        record(
          item,
          ['id', 'name', 'query_code'],
          ['start_day_offset', 'end_day_offset', 'start_offset', 'end_offset', 'event_type']
        );
        text(item.id);
        text(item.name);
        text(item.query_code);
        for (const key of ['start_day_offset', 'end_day_offset', 'start_offset', 'end_offset'])
          if (own(item, key)) finite(item[key]);
        if (own(item, 'event_type')) text(item.event_type);
      });
      break;
    case 'settings.views':
      array(value, item => {
        record(item, ['id', 'name', 'elements']);
        text(item.id);
        text(item.name);
        array(item.elements, element => {
          record(element, ['type'], ['size', 'props']);
          requirePolicy(VIEW_TYPES.includes(element.type));
          if (own(element, 'size')) finite(element.size);
          if (own(element, 'props')) object(element.props);
        });
      });
      break;
    case 'settings.privacy_filters':
      array(value, item => {
        item = nativeRecord(
          item,
          ['enabled', 'bucket_prefix', 'field', 'pattern', 'action', 'replacement'],
          ['bucket_prefix', 'field', 'replacement'],
          parsed,
          true
        );
        boolean(item.enabled);
        text(item.pattern);
        requirePolicy(['drop', 'redact'].includes(item.action));
        text(item.field);
        for (const key of ['bucket_prefix', 'replacement'])
          if (own(item, key) && item[key] !== null) text(item[key]);
        if (item.action === 'redact') text(item.replacement, MAX_BYTES, true);
      });
      break;
    case 'capture.minimization':
      record(value, [
        'window',
        'idle',
        'browser',
        'titles',
        'urls',
        'paths',
        'excluded_apps',
        'excluded_domains',
      ]);
      for (const key of ['window', 'idle', 'browser', 'titles', 'urls', 'paths'])
        boolean(value[key]);
      array(value.excluded_apps, item => text(item), 200);
      array(value.excluded_domains, item => text(item), 200);
      break;
    case 'egress.user_policy':
      userPolicy(value, parsed);
      break;
    case 'egress.signed_bundle':
      signedBundle(value, parsed);
      break;
  }
}
function portable(scope: PolicyField, value: any, parsed: Parsed) {
  record(value, ['schema_version', 'present', 'value']);
  schema(value, parsed);
  boolean(value.present);
  if (!value.present) requirePolicy(value.value === null);
  else {
    if (scope === 'settings.rawRetentionDays') smallUint(value, 'value', parsed, 3650);
    payload(scope, value.value, parsed);
  }
}
const DIFF_FIELDS = [
  'schema_version',
  'from_version',
  'to_version',
  'hard_deny_version_before',
  'hard_deny_version_after',
  'added_destinations',
  'removed_destinations',
  'changed_destinations',
  'added_purposes',
  'removed_purposes',
  'changed_purposes',
  'added_organization_rules',
  'removed_organization_rules',
  'added_user_rules',
  'removed_user_rules',
  'added_safe_zone_patterns',
  'removed_safe_zone_patterns',
  'after_hours_before',
  'after_hours_after',
];
function diff(value: any, parsed: Parsed) {
  record(value, DIFF_FIELDS);
  schema(value, parsed);
  for (const key of [
    'from_version',
    'to_version',
    'hard_deny_version_before',
    'hard_deny_version_after',
  ])
    u64(value, key, parsed);
  for (const key of ['added_destinations', 'changed_destinations'])
    array(value[key], item => destination(item, parsed));
  for (const key of ['added_purposes', 'changed_purposes'])
    array(value[key], item => purpose(item, parsed));
  for (const key of ['removed_destinations', 'removed_purposes']) array(value[key], identifier);
  for (const key of [
    'added_organization_rules',
    'removed_organization_rules',
    'added_user_rules',
    'removed_user_rules',
  ])
    array(value[key], item => rule(item, parsed));
  for (const key of ['added_safe_zone_patterns', 'removed_safe_zone_patterns'])
    array(value[key], item => pattern(item, parsed));
  schedule(value.after_hours_before, parsed);
  schedule(value.after_hours_after, parsed);
}
function firewall(value: any, scope: PolicyField, parsed: Parsed) {
  requirePolicy(
    value.kind === (scope === 'egress.signed_bundle' ? 'signed-bundle' : 'user-policy')
  );
  if (value.kind === 'signed-bundle') record(value, ['kind', 'diff']);
  else {
    record(value, ['kind', 'preview_id', 'diff']);
    text(value.preview_id, 128, true);
  }
  diff(value.diff, parsed);
}
export function parsePolicyContext(raw: string): { schema_version: 1; context_id: string } {
  const parsed = decoded(raw),
    value = parsed.value;
  record(value, ['schema_version', 'context_id']);
  schema(value, parsed);
  hex(value.context_id);
  return Object.freeze(value);
}
export function parsePolicyPage(raw: string): PolicyPage {
  const parsed = decoded(raw),
    value = parsed.value;
  record(value, ['schema_version', 'candidates', 'next_cursor']);
  schema(value, parsed);
  array(value.candidates, item => candidate(item,parsed), 256);
  requirePolicy(
    value.candidates.every(
      (item: any, i: number) => i === 0 || value.candidates[i - 1].candidate_id < item.candidate_id
    )
  );
  if (value.next_cursor !== null) {
    hex(value.next_cursor);
    requirePolicy(
      value.candidates.length > 0 &&
        value.next_cursor === value.candidates[value.candidates.length - 1].candidate_id
    );
  }
  value.candidates.forEach(Object.freeze);
  return value;
}
export function parsePolicyPreview(raw: string, selected?: PolicyCandidate): PolicyPreview {
  const parsed = decoded(raw),
    value = parsed.value;
  record(value, ['policy', 'firewall', 'accept_remote_available', 'reason']);
  const policy = value.policy;
  record(policy, ['schema_version', 'candidate', 'current', 'proposed', 'expected_review_sha256']);
  schema(policy, parsed);
  candidate(policy.candidate,parsed);
  hex(policy.expected_review_sha256);
  if (selected)
    requirePolicy(
      ['candidate_id','field','device_id','counter','policy_version'].every(key => policy.candidate[key] === (selected as any)[key]) &&
      !!selected.recovery_source === !!policy.candidate.recovery_source &&
      (!selected.recovery_source || ['schema_version','vault_id','key_epoch','snapshot_id'].every(key => selected.recovery_source[key] === policy.candidate.recovery_source[key]))
    );
  portable(policy.candidate.field, policy.current, parsed);
  portable(policy.candidate.field, policy.proposed, parsed);
  boolean(value.accept_remote_available);
  if (policy.candidate.field.startsWith('egress.')) {
    if (value.accept_remote_available) {
      requirePolicy(
        value.reason === null &&
          (policy.candidate.field !== 'egress.signed_bundle' || policy.proposed.present)
      );
      object(value.firewall);
      firewall(value.firewall, policy.candidate.field, parsed);
    } else requirePolicy(value.reason === 'firewall-review-unavailable' && value.firewall === null);
  } else
    requirePolicy(
      value.accept_remote_available && value.reason === null && value.firewall === null
    );
  Object.freeze(policy.candidate);
  Object.freeze(policy.current);
  Object.freeze(policy.proposed);
  Object.freeze(policy);
  return Object.freeze({
    policy,
    accept_remote_available: value.accept_remote_available,
    reason: value.reason,
    currentRaw: rawProperty(raw, parsed, policy.current, 'value'),
    proposedRaw: rawProperty(raw, parsed, policy.proposed, 'value'),
    firewallRaw: rawProperty(raw, parsed, value, 'firewall'),
  });
}
export function policyChoiceBody(preview: PolicyPreview, decision: PolicyDecision): string {
  requirePolicy(decision === 'keep-local' || decision === 'accept-remote');
  if (decision === 'accept-remote') requirePolicy(preview.accept_remote_available);
  const choice = {
    schema_version: 1,
    candidate_id: preview.policy.candidate.candidate_id,
    expected_review_sha256: preview.policy.expected_review_sha256,
    decision,
  };
  const body = `{"choice":${JSON.stringify(choice)},"firewall":${preview.firewallRaw}}`;
  requirePolicy(utf8Bytes(body) <= MAX_BYTES);
  return body;
}
export function parsePolicyChoice(
  raw: string,
  expected: { field: PolicyField; decision: PolicyDecision }
): PolicyChoiceResult {
  const parsed = decoded(raw),
    value = parsed.value;
  record(value, ['schema_version', 'field', 'decision', 'applied']);
  schema(value, parsed);
  field(value.field);
  boolean(value.applied);
  requirePolicy(
    value.field === expected.field &&
      value.decision === expected.decision &&
      value.applied === (value.decision === 'accept-remote')
  );
  return Object.freeze(value);
}
