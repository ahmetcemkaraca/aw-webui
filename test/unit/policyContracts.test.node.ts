import {
  parsePolicyContext,
  parsePolicyPage,
  parsePolicyPreview,
  parsePolicyChoice,
  policyChoiceBody,
} from '~/util/policyContracts';
import { candidate, portable, policyPreview, userPreview, firewallDiff } from './fixtures/policies';

const raw = (value: unknown) => JSON.stringify(value);
test('accepts exact context/page records and keeps native counters as full decimal strings', () => {
  expect(
    parsePolicyContext(raw({ schema_version: 1, context_id: 'c'.repeat(64) })).context_id
  ).toBe('c'.repeat(64));
  const entry = {
    ...candidate(),
    counter: '18446744073709551615',
    policy_version: '9007199254740993',
  };
  expect(
    parsePolicyPage(raw({ schema_version: 1, candidates: [entry], next_cursor: null }))
      .candidates[0].counter
  ).toBe(entry.counter);
});
test('rejects arrays unknown/duplicate records and invalid metadata order cursor and numeric types', () => {
  for (const text of [
    '[1,"' + 'c'.repeat(64) + '"]',
    raw({ schema_version: 1, context_id: 'c'.repeat(64), trusted: true }),
    '{"schema_version":1,"\\u0073chema_version":1,"context_id":"' + 'c'.repeat(64) + '"}',
    raw({ schema_version: 1.1, context_id: 'c'.repeat(64) }),
  ])
    expect(() => parsePolicyContext(text)).toThrow();
  for (const entries of [
    [candidate(), candidate()],
    [candidate('settings.theme', 'd'.repeat(64)), candidate()],
    [{ ...candidate(), counter: 1 }],
    [candidate('capture.recording')],
  ])
    expect(() =>
      parsePolicyPage(raw({ schema_version: 1, candidates: entries, next_cursor: null }))
    ).toThrow();
  expect(() =>
    parsePolicyPage(
      raw({ schema_version: 1, candidates: [candidate()], next_cursor: 'd'.repeat(64) })
    )
  ).toThrow();
});
test('keeps absence stored null and empty values distinct and never changes native values', () => {
  for (const val of [portable(null, false), portable(null), portable([])]) {
    const preview: any = policyPreview('settings.classes', [], []);
    preview.policy.proposed = val;
    const decoded = parsePolicyPreview(raw(preview), candidate('settings.classes'));
    expect(decoded.policy.proposed.present).toBe(val.present);
    expect(decoded.proposedRaw).toBe(raw(val.value));
  }
  const invalid: any = policyPreview();
  invalid.policy.proposed = portable('light', false);
  expect(() => parsePolicyPreview(raw(invalid))).toThrow();
});
test('binds native preview and choice response to the exact selected/requested identity', () => {
  expect(() =>
    parsePolicyPreview(raw(policyPreview()), candidate('settings.theme', 'd'.repeat(64)))
  ).toThrow();
  expect(() => parsePolicyPreview(raw(policyPreview()), candidate('settings.views'))).toThrow();
  expect(
    parsePolicyChoice(
      raw({ schema_version: 1, field: 'settings.theme', decision: 'keep-local', applied: false }),
      { field: 'settings.theme', decision: 'keep-local' }
    ).applied
  ).toBe(false);
  for (const result of [
    { schema_version: 1, field: 'settings.views', decision: 'keep-local', applied: false },
    { schema_version: 1, field: 'settings.theme', decision: 'accept-remote', applied: true },
    { schema_version: 1, field: 'settings.theme', decision: 'keep-local', applied: true },
  ])
    expect(() =>
      parsePolicyChoice(raw(result), { field: 'settings.theme', decision: 'keep-local' })
    ).toThrow();
});
test('preserves full native u64 text in display and the actual reviewed Firewall request', () => {
  const preview = userPreview();
  const text = raw(preview).replace('"to_version":3', '"to_version":18446744073709551615');
  const decoded = parsePolicyPreview(text, candidate('egress.user_policy'));
  expect(decoded.firewallRaw).toContain('"to_version":18446744073709551615');
  const body = policyChoiceBody(decoded, 'accept-remote');
  expect(body).toContain('"to_version":18446744073709551615');
  expect(body).not.toContain('18446744073709552000');
});
test('rejects noncanonical/overflow native u64 tokens and closed nested Firewall records', () => {
  const text = raw(userPreview());
  for (const value of ['3.0', '3e0', '-0', '-1', '18446744073709551616', '"3"'])
    expect(() =>
      parsePolicyPreview(text.replace('"to_version":3', '"to_version":' + value))
    ).toThrow();
  const unknown: any = userPreview();
  unknown.firewall.diff.added_safe_zone_patterns[0].trusted = true;
  expect(() => parsePolicyPreview(raw(unknown))).toThrow();
  const array: any = userPreview();
  array.firewall.diff = Object.values(firewallDiff());
  expect(() => parsePolicyPreview(raw(array))).toThrow();
});
test('unavailable Firewall data remains keepable and cannot produce an accept request', () => {
  const preview: any = policyPreview('egress.signed_bundle');
  preview.policy.current = portable(null, false);
  preview.policy.proposed = portable(null, false);
  preview.accept_remote_available = false;
  preview.reason = 'firewall-review-unavailable';
  const decoded = parsePolicyPreview(raw(preview));
  expect(policyChoiceBody(decoded, 'keep-local')).toContain('"keep-local"');
  expect(() => policyChoiceBody(decoded, 'accept-remote')).toThrow();
  preview.accept_remote_available = true;
  expect(() => parsePolicyPreview(raw(preview))).toThrow();
});
test('preserves native category fallback open metadata regex/select_keys and deep portable metadata', () => {
  const deep = JSON.parse('{"extra":' + '['.repeat(70) + '0' + ']'.repeat(70) + '}');
  const categories = [
    {
      id: { legacy: true },
      name: ['任意'.repeat(100)],
      rule: {
        type: 'regex',
        regex: '(?<=foo)bar',
        ignore_case: false,
        select_keys: ['app'],
        legacy: 1,
      },
      data: { score: 'display-only', ...deep },
      metadata: 'preserved',
    },
  ];
  const decoded = parsePolicyPreview(raw(policyPreview('settings.classes', null, categories)));
  expect(decoded.proposedRaw).toBe(raw(categories));
  const emptySelection = parsePolicyPreview(
    raw(policyPreview('settings.active_set_ids', ['orphan', 'orphan'], []))
  );
  expect(emptySelection.proposedRaw).toBe('[]');
});
test('accepts real legacy numeric-text duration fractional notification views and empty saved query storage', () => {
  for (const [field, current, proposed] of [
    ['settings.durationDefault', 3600, '14400'],
    [
      'settings.uncategorizedNotificationData',
      { isEnabled: true, minTotalSeconds: 0, minRatio: 0.3 },
      { isEnabled: false, minTotalSeconds: 0.5, minRatio: 0.7 },
    ],
    [
      'settings.views',
      [],
      [
        {
          id: '',
          name: '',
          elements: [{ type: 'custom_vis', size: 0.5, props: { legacy: 'open' } }],
        },
      ],
    ],
    [
      'settings.saved_queries',
      [],
      [{ id: '', name: '', query_code: '', start_day_offset: -23, end_offset: 0.5 }],
    ],
  ] as const)
    expect(() => parsePolicyPreview(raw(policyPreview(field, current, proposed)))).not.toThrow();
});
test('rejects runtime capture fields malformed known settings and byte overflow', () => {
  const prefs = {
    window: true,
    idle: true,
    browser: false,
    titles: false,
    urls: false,
    paths: false,
    excluded_apps: [],
    excluded_domains: [],
  };
  expect(() =>
    parsePolicyPreview(
      raw(policyPreview('capture.minimization', prefs, { ...prefs, recording: true }))
    )
  ).toThrow();
  expect(() => parsePolicyPreview(raw(policyPreview('settings.theme', 'dark', 'neon')))).toThrow();
  expect(() =>
    parsePolicyPreview(raw(policyPreview('settings.rawRetentionDays', 0, 3651)))
  ).toThrow();
  expect(() =>
    parsePolicyContext(
      ' '.repeat(4 * 1024 * 1024) + raw({ schema_version: 1, context_id: 'c'.repeat(64) })
    )
  ).toThrow();
});

import { readFileSync } from 'fs';
import { resolve } from 'path';
const nativeCases = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../aw-datastore/test-vectors/sync-policy-portable-v1.json'),
    'utf8'
  )
);
test.each(nativeCases)(
  'matches independently checked Native portable shape: $field $accepted',
  row => {
    const preview: any = policyPreview(row.field);
    preview.policy.current = portable(null, false);
    preview.policy.proposed = 'PORTABLE_PLACEHOLDER';
    if (row.field.startsWith('egress.')) {
      preview.accept_remote_available = false;
      preview.reason = 'firewall-review-unavailable';
    }
    const text = raw(preview).replace('"PORTABLE_PLACEHOLDER"', row.portable_json);
    if (row.accepted) expect(() => parsePolicyPreview(text)).not.toThrow();
    else expect(() => parsePolicyPreview(text)).toThrow();
  }
);
test('freezes the reviewed identifiers flags and exact raw payload before choice', () => {
  const preview = parsePolicyPreview(raw(userPreview()));
  expect(Object.isFrozen(preview)).toBe(true);
  expect(Object.isFrozen(preview.policy)).toBe(true);
  expect(Object.isFrozen(preview.policy.candidate)).toBe(true);
  expect(() => {
    (preview as any).firewallRaw = '{}';
  }).toThrow();
  expect(policyChoiceBody(preview, 'keep-local')).toContain(preview.firewallRaw);
});
test('preserves and binds authenticated recovery snapshot metadata without presenting it as a device', () => {
  const source = {schema_version:1,vault_id:'AgICAgICAgICAgICAgICAg',key_epoch:'1',snapshot_id:'AwMDAwMDAwMDAwMDAwMDAw'};
  const recovered = {...candidate(),device_id:source.snapshot_id, recovery_source:source};
  const page = parsePolicyPage(raw({schema_version:1,candidates:[recovered],next_cursor:null}));
  const preview:any = policyPreview(); preview.policy.candidate = recovered;
  const parsed = parsePolicyPreview(raw(preview),page.candidates[0]);
  expect(parsed.policy.candidate.recovery_source).toEqual(source);
  expect(Object.isFrozen(parsed.policy.candidate.recovery_source)).toBe(true);
  preview.policy.candidate = {...recovered,device_id:'AQEBAQEBAQEBAQEBAQEBAQ',recovery_source:{...source,snapshot_id:'AQEBAQEBAQEBAQEBAQEBAQ'}};
  expect(()=>parsePolicyPreview(raw(preview),page.candidates[0])).toThrow();
  for (const invalid of [{...source, trusted:true},{...source,key_epoch:'0'},[1,source.vault_id,'1',source.snapshot_id],null]) {
    preview.policy.candidate = {...recovered,recovery_source:invalid};
    expect(()=>parsePolicyPreview(raw(preview))).toThrow();
  }
});
