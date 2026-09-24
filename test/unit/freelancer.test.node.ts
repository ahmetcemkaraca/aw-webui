import {
  buildApprovedTimesheet,
  buildInvoiceDraft,
  buildProjectTimesheetLines,
  calculateInvoiceSubtotalMinor,
  isExactApprovedTimesheetPayload,
  roundFreelancerDuration,
  serializeApprovedTimesheet,
  serializeApprovedTimesheetCsv,
  serializeProjectProfitabilityCsv,
  summarizeProjectProfitability,
  updateFreelancerProject,
} from '~/util/freelancer';
import { hasFeatureEntitlement } from '~/util/entitlement';

describe('approved Freelancer artifacts', () => {
  test('requires both a shipped capability and a verified current/grace entitlement', () => {
    const status = { plan_id: 'freelancer', feature_ids: ['freelancer-workspace'], access: 'current' };
    expect(hasFeatureEntitlement('Planned', status, 'freelancer-workspace')).toBe(false);
    expect(hasFeatureEntitlement('Available', null, 'freelancer-workspace')).toBe(false);
    expect(hasFeatureEntitlement('Available', { ...status, access: 'grace' }, 'freelancer-workspace')).toBe(true);
    expect(hasFeatureEntitlement('Available', { ...status, feature_ids: ['e2ee-sync'] }, 'freelancer-workspace')).toBe(false);
  });

  test('maps only locally assigned categories to opaque project aliases', () => {
    const workspace = {
      schema_version: 1,
      revision: 1,
      projects: [
        {
          project_alias: 'project-parent', label: 'Private parent', billable_default: true,
          rounding_increment_seconds: 0, rounding_mode: 'none', currency_code: null, hourly_rate_minor: null,
        },
        {
          project_alias: 'project-client', label: 'Private client name', billable_default: true,
          rounding_increment_seconds: 0, rounding_mode: 'none', currency_code: null, hourly_rate_minor: null,
        },
      ],
      category_rules: [
        { category_path: ['Work'], project_alias: 'project-parent' },
        { category_path: ['Work', 'Client'], project_alias: 'project-client' },
      ],
    } as any;
    const daily = [{ date: '2026-09-23', events: [
      { timestamp: '2026-09-23T09:00:00Z', duration: 60, data: { $category: ['Work', 'Client'], window_title: 'private marker' } },
      { timestamp: '2026-09-23T09:02:00Z', duration: 60, data: { $category: ['Work', 'Client'], window_title: 'private marker' } },
      { timestamp: '2026-09-23T09:03:00Z', duration: 60, data: { $category: ['Work', 'Internal'], url: 'private marker' } },
      { timestamp: '2026-09-23T11:00:00Z', duration: 600, data: { $category: ['Personal'] } },
    ] }];
    const result = buildProjectTimesheetLines(daily as any, workspace, 60);
    expect(result.lines).toEqual([
      { project_alias: 'project-client', date: '2026-09-23', source_duration_seconds: 180, approved_duration_seconds: 180, billable: true, rounding_increment_seconds: 0, rounding_mode: 'none', mapping_rule_paths: [['Work', 'Client']], mapping_confidence: 'exact' },
      { project_alias: 'project-parent', date: '2026-09-23', source_duration_seconds: 60, approved_duration_seconds: 60, billable: true, rounding_increment_seconds: 0, rounding_mode: 'none', mapping_rule_paths: [['Work']], mapping_confidence: 'inherited' },
    ]);
    expect(result.unmapped_duration_seconds).toBe(600);
    expect(result.nonbillable_duration_seconds).toBe(0);
    expect(JSON.stringify(result)).not.toContain('private marker');
    expect(JSON.stringify(result)).not.toContain('Private client name');
  });

  test('corrects local project fields and category rules without mutating exported identity', () => {
    const workspace = {
      schema_version: 1,
      revision: 2,
      projects: [
        { project_alias: 'alpha', label: 'Old label', billable_default: true, rounding_increment_seconds: 0, rounding_mode: 'none', currency_code: null, hourly_rate_minor: null },
        { project_alias: 'beta', label: 'Other project', billable_default: false, rounding_increment_seconds: 0, rounding_mode: 'none', currency_code: null, hourly_rate_minor: null },
      ],
      category_rules: [
        { category_path: ['Work', 'Old'], project_alias: 'alpha' },
        { category_path: ['Personal'], project_alias: 'beta' },
      ],
    } as any;
    const updated = updateFreelancerProject(workspace, {
      ...workspace.projects[0], label: 'Corrected label',
    }, [['Work', 'Corrected']]);
    expect(updated.revision).toBe(2);
    expect(updated.projects[0].project_alias).toBe('alpha');
    expect(updated.projects[0].label).toBe('Corrected label');
    expect(updated.category_rules).toEqual([
      { category_path: ['Personal'], project_alias: 'beta' },
      { category_path: ['Work', 'Corrected'], project_alias: 'alpha' },
    ]);
    expect(workspace.projects[0].label).toBe('Old label');
    expect(() => updateFreelancerProject(workspace, workspace.projects[0], [['Personal']])).toThrow();
  });

  test('rejects per-project rounding that would make one day exceed 24 hours', () => {
    const workspace = {
      schema_version: 1,
      revision: 1,
      projects: ['one', 'two'].map(project_alias => ({
        project_alias, label: project_alias, billable_default: true,
        rounding_increment_seconds: 3600, rounding_mode: 'up',
        currency_code: null, hourly_rate_minor: null,
      })),
      category_rules: [
        { category_path: ['Work', 'One'], project_alias: 'one' },
        { category_path: ['Work', 'Two'], project_alias: 'two' },
      ],
    } as any;
    const daily = [{ date: '2026-09-23', events: [
      { timestamp: '2026-09-23T00:00:00Z', duration: 40_000, data: { $category: ['Work', 'One'] } },
      { timestamp: '2026-09-23T11:06:40Z', duration: 46_000, data: { $category: ['Work', 'Two'] } },
    ] }];
    expect(() => buildProjectTimesheetLines(daily as any, workspace, 0)).toThrow();
  });

  test('summarizes local income, costs, and margin without tax or client fields', () => {
    const workspace = {
      schema_version: 1,
      revision: 1,
      projects: [{
        project_alias: 'project-local', client_alias: 'client-private', label: 'Private label',
        billable_default: true, rounding_increment_seconds: 0, rounding_mode: 'none',
        currency_code: 'EUR', hourly_rate_minor: 7500, hourly_cost_minor: 3000,
      }],
      category_rules: [],
    } as any;
    const summary = summarizeProjectProfitability([
      { project_alias: 'project-local', date: '2026-09-23', source_duration_seconds: 1800, approved_duration_seconds: 1800, billable: true, rounding_increment_seconds: 0, rounding_mode: 'none', mapping_rule_paths: [], mapping_confidence: 'exact' },
      { project_alias: 'project-local', date: '2026-09-24', source_duration_seconds: 3600, approved_duration_seconds: 3600, billable: false, rounding_increment_seconds: 0, rounding_mode: 'none', mapping_rule_paths: [], mapping_confidence: 'exact' },
    ], workspace);
    expect(summary).toEqual([{
      project_alias: 'project-local', currency_code: 'EUR',
      billable_duration_seconds: 1800, nonbillable_duration_seconds: 3600,
      income_minor: 3750, cost_minor: 4500, margin_minor: -750,
    }]);
    const csv = serializeProjectProfitabilityCsv(summary);
    expect(JSON.stringify(summary)).not.toContain('client-private');
    expect(csv).toContain('income_minor,cost_minor,margin_minor');
    expect(csv).toContain('3750,4500,-750');
    expect(csv).not.toContain('client-private');
  });

  test('does not include an intervening project when bridging a project gap', () => {
    const workspace = {
      schema_version: 1,
      revision: 1,
      projects: ['alpha', 'beta'].map(project_alias => ({
        project_alias, label: project_alias, billable_default: true,
        rounding_increment_seconds: 0, rounding_mode: 'none',
        currency_code: null, hourly_rate_minor: null,
      })),
      category_rules: [
        { category_path: ['Work', 'Alpha'], project_alias: 'alpha' },
        { category_path: ['Work', 'Beta'], project_alias: 'beta' },
      ],
    } as any;
    const result = buildProjectTimesheetLines([{
      date: '2026-09-23',
      events: [
        { timestamp: '2026-09-23T09:00:00Z', duration: 30, data: { $category: ['Work', 'Alpha'] } },
        { timestamp: '2026-09-23T09:00:40Z', duration: 20, data: { $category: ['Work', 'Beta'] } },
        { timestamp: '2026-09-23T09:01:00Z', duration: 30, data: { $category: ['Work', 'Alpha'] } },
      ],
    }] as any, workspace, 60);
    expect(result.lines.map(line => [line.project_alias, line.source_duration_seconds])).toEqual([
      ['alpha', 60], ['beta', 20],
    ]);
  });

  test('reports local time that rounds down to zero instead of silently exporting it', () => {
    const workspace = {
      schema_version: 1,
      revision: 1,
      projects: [{
        project_alias: 'project-small', label: 'Small', billable_default: true,
        rounding_increment_seconds: 900, rounding_mode: 'down',
        currency_code: null, hourly_rate_minor: null,
      }],
      category_rules: [{ category_path: ['Work'], project_alias: 'project-small' }],
    } as any;
    const result = buildProjectTimesheetLines([{
      date: '2026-09-23',
      events: [{ timestamp: '2026-09-23T09:00:00Z', duration: 60, data: { $category: ['Work'] } }],
    }] as any, workspace, 0);
    expect(result.lines).toEqual([]);
    expect(result.unmapped_duration_seconds).toBe(60);
  });

  test('serializes only the strict approved client-safe fields in stable order', () => {
    const timesheet = buildApprovedTimesheet({
      project_alias: 'project-9af31c',
      date: '2026-09-23',
      approved_duration_seconds: 18_000,
      user_note: 'Approved sprint work',
    });
    expect(Object.keys(timesheet)).toEqual([
      'schema_version', 'project_alias', 'date', 'approved_duration_seconds', 'user_note',
    ]);
    expect(serializeApprovedTimesheet(timesheet)).toBe(
      '{"approved_duration_seconds":18000,"date":"2026-09-23","project_alias":"project-9af31c","schema_version":1,"user_note":"Approved sprint work"}'
    );
  });

  test('CSV export contains the same fields and neutralizes spreadsheet formulas', () => {
    const approved = buildApprovedTimesheet({
      project_alias: 'project-9af31c',
      date: '2026-09-23',
      approved_duration_seconds: 18_000,
      user_note: ' =HYPERLINK("https://bad.invalid")',
    });
    const csv = serializeApprovedTimesheetCsv(approved);
    expect(csv.split('\r\n')[0]).toBe('project_alias,date,approved_duration_seconds,user_note');
    expect(csv).toContain("' =HYPERLINK(");
    expect(csv).not.toContain('window_title');
  });

  test('accepts only the exact canonical Egress payload', () => {
    const approved = buildApprovedTimesheet({
      project_alias: 'project-9af31c', date: '2026-09-23',
      approved_duration_seconds: 18_000, user_note: null,
    });
    expect(isExactApprovedTimesheetPayload(approved, {
      user_note: null, schema_version: 1, project_alias: 'project-9af31c',
      date: '2026-09-23', approved_duration_seconds: 18_000,
    })).toBe(true);
    expect(isExactApprovedTimesheetPayload(approved, {
      schema_version: 1, project_alias: 'project-9af31c',
      date: '2026-09-23', approved_duration_seconds: 18_000,
    })).toBe(false);
    expect(isExactApprovedTimesheetPayload(approved, {
      ...approved, window_title: 'private',
    })).toBe(false);
    expect(isExactApprovedTimesheetPayload(approved, {
      ...approved, approved_duration_seconds: 17_999,
    })).toBe(false);
  });

  test('rejects raw activity, invalid dates, non-positive durations, and secret-bearing notes', () => {
    expect(() => buildApprovedTimesheet({
      project_alias: 'project-9af31c', date: '2026-09-23',
      approved_duration_seconds: 1, user_note: null, window_title: 'secret',
    } as any)).toThrow();
    expect(() => buildApprovedTimesheet({
      project_alias: 'project-9af31c', date: '2026-09-23',
      approved_duration_seconds: 1, user_note: null, client_alias: 'client-secret',
    } as any)).toThrow();
    expect(() => buildApprovedTimesheet({
      project_alias: 'project-9af31c', date: '2026-02-30',
      approved_duration_seconds: 1, user_note: null,
    })).toThrow();
    expect(() => buildApprovedTimesheet({
      project_alias: 'project-9af31c', date: '2026-09-23',
      approved_duration_seconds: 0, user_note: null,
    })).toThrow();
    expect(() => buildApprovedTimesheet({
      project_alias: 'project-9af31c', date: '2026-09-23',
      approved_duration_seconds: 1, user_note: 'private\nvalue',
    })).toThrow();
  });

  test('uses the versioned visible rounding modes and rejects a rounded day over 24 hours', () => {
    expect(roundFreelancerDuration(1_000, 900, 'nearest')).toBe(900);
    expect(roundFreelancerDuration(1_350, 900, 'nearest')).toBe(1_800);
    expect(roundFreelancerDuration(1_001, 900, 'down')).toBe(900);
    expect(roundFreelancerDuration(1_001, 900, 'up')).toBe(1_800);
    expect(roundFreelancerDuration(7_321, 0, 'none')).toBe(7_321);
    expect(() => roundFreelancerDuration(86_001, 1_000, 'up')).toThrow();
  });

  test('builds a half-up minor-unit invoice draft without tax fields', () => {
    const draft = buildInvoiceDraft({
      project_alias: 'project-9af31c',
      period_start: '2026-09-01',
      period_end: '2026-09-23',
      currency_code: 'EUR',
      approved_duration_seconds: 1_800,
      hourly_rate_minor: 7_500,
    });
    expect(draft.status).toBe('draft');
    expect(draft.subtotal_minor).toBe(3_750);
    expect(draft.tax_status).toBe('not_calculated');
    expect(Object.keys(draft)).not.toContain('tax_id');
    expect(calculateInvoiceSubtotalMinor(7_500, 1_800)).toBe(3_750);
    expect(calculateInvoiceSubtotalMinor(1, 1_800)).toBe(1);
    expect(() => calculateInvoiceSubtotalMinor(Number.MAX_SAFE_INTEGER, 86_400)).toThrow();
  });
});
