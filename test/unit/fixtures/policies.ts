export const candidate = (field = 'settings.theme', id = 'a'.repeat(64)) => ({
  candidate_id: id,
  field,
  device_id: 'AQEBAQEBAQEBAQEBAQEBAQ',
  counter: '1',
  policy_version: '1',
});
export const portable = (value: unknown, present = true) => ({ schema_version: 1, present, value });
export const policyPreview = (
  field = 'settings.theme',
  current: unknown = 'dark',
  proposed: unknown = 'light'
) => ({
  policy: {
    schema_version: 1,
    candidate: candidate(field),
    current: portable(current),
    proposed: portable(proposed),
    expected_review_sha256: 'b'.repeat(64),
  },
  firewall: null,
  accept_remote_available: true,
  reason: null,
});
export const firewallDiff = () => ({
  schema_version: 1,
  from_version: 0,
  to_version: 3,
  hard_deny_version_before: 0,
  hard_deny_version_after: 1,
  added_destinations: [],
  removed_destinations: [],
  changed_destinations: [],
  added_purposes: [],
  removed_purposes: [],
  changed_purposes: [],
  added_organization_rules: [],
  removed_organization_rules: [],
  added_user_rules: [],
  removed_user_rules: [],
  added_safe_zone_patterns: [],
  removed_safe_zone_patterns: [],
  after_hours_before: null,
  after_hours_after: null,
});
export const userPolicy = () => ({
  schema_version: 1,
  user_rules: [],
  safe_zone_patterns: [],
  after_hours: null,
});
export const userPreview = () => ({
  ...policyPreview('egress.user_policy', userPolicy(), {
    ...userPolicy(),
    safe_zone_patterns: [{ kind: 'application', value: 'Editor' }],
  }),
  firewall: {
    kind: 'user-policy',
    preview_id: 'native-preview',
    diff: {
      ...firewallDiff(),
      added_safe_zone_patterns: [{ kind: 'application', value: 'Editor' }],
    },
  },
});
