export const APPROVED_TIMESHEET_SCHEMA_VERSION_V1 = 1 as const;
export const APPROVED_TIMESHEET_MAX_SECONDS_PER_DAY_V1 = 86_400;
export const APPROVED_TIMESHEET_MAX_NOTE_BYTES_V1 = 1_000;
export const FREELANCER_MAX_SAFE_MINOR_UNITS_V1 = Number.MAX_SAFE_INTEGER;
export const FREELANCER_TIMESHEET_EGRESS_PURPOSE_V1 = 'freelancer-timesheet-v1';

export type FreelancerRoundingModeV1 = 'none' | 'up' | 'down' | 'nearest';

export interface FreelancerProjectV1 {
  project_alias: string;
  client_alias: string | null;
  label: string;
  billable_default: boolean;
  rounding_increment_seconds: number;
  rounding_mode: FreelancerRoundingModeV1;
  currency_code: string | null;
  hourly_rate_minor: number | null;
  hourly_cost_minor: number | null;
}

export interface FreelancerCategoryRuleV1 {
  category_path: string[];
  project_alias: string;
}

export interface FreelancerWorkspaceV1 {
  schema_version: 1;
  revision: number;
  projects: FreelancerProjectV1[];
  category_rules: FreelancerCategoryRuleV1[];
}

export function updateFreelancerProject(
  workspace: FreelancerWorkspaceV1,
  project: FreelancerProjectV1,
  categoryPaths: string[][],
): FreelancerWorkspaceV1 {
  if (!workspace.projects.some(item => item.project_alias === project.project_alias)) {
    throw new TypeError('The project to update does not exist.');
  }
  const rules = workspace.category_rules.filter(rule => rule.project_alias !== project.project_alias);
  const paths = new Set(rules.map(rule => JSON.stringify(rule.category_path)));
  for (const category_path of categoryPaths) {
    const key = JSON.stringify(category_path);
    if (!category_path.length || paths.has(key)) throw new TypeError('A category can map to only one project.');
    paths.add(key);
    rules.push({ category_path: [...category_path], project_alias: project.project_alias });
  }
  return {
    ...workspace,
    projects: workspace.projects.map(item => item.project_alias === project.project_alias ? project : item),
    category_rules: rules,
  };
}

export interface ProjectTimesheetLineV1 {
  project_alias: string;
  date: string;
  source_duration_seconds: number;
  approved_duration_seconds: number;
  billable: boolean;
  rounding_increment_seconds: number;
  rounding_mode: FreelancerRoundingModeV1;
  mapping_rule_paths: string[][];
  mapping_confidence: 'exact' | 'inherited' | 'mixed';
}

export function buildProjectTimesheetLines(
  dailyReports: { date: string; events: any[] }[],
  workspace: FreelancerWorkspaceV1,
  breakTimeSeconds: number,
): { lines: ProjectTimesheetLineV1[]; unmapped_duration_seconds: number; nonbillable_duration_seconds: number } {
  if (!Array.isArray(dailyReports) || !Number.isFinite(breakTimeSeconds) || breakTimeSeconds < 0) {
    throw new TypeError('Timesheet report input is invalid.');
  }
  const projects = new Map(workspace.projects.map(project => [project.project_alias, project]));
  const assigned = new Map<string, {
    project: FreelancerProjectV1;
    sourceDurationSeconds: number;
    bridgedGapSeconds: number;
    rulePaths: Map<string, string[]>;
    exactMappings: number;
    inheritedMappings: number;
  }>();
  let unmapped = 0;

  for (const day of dailyReports) {
    if (!isIsoDate(day.date) || !Array.isArray(day.events)) throw new TypeError('Timesheet report day is invalid.');
    const intervals: { key: string | null; timestamp: number; duration: number }[] = [];
    for (const event of day.events) {
      const duration = event?.duration;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
        throw new TypeError('Timesheet report interval is invalid.');
      }
      const timestamp = new Date(event?.timestamp).getTime();
      if (!Number.isFinite(timestamp)) throw new TypeError('Timesheet report interval is invalid.');
      const category = event?.data?.$category;
      const rules = workspace.category_rules.filter(rule => Array.isArray(category)
        && category.length >= rule.category_path.length
        && rule.category_path.every((part, index) => category[index] === part))
        .sort((left, right) => right.category_path.length - left.category_path.length);
      const rule = rules[0];
      const project = rule ? projects.get(rule.project_alias) : undefined;
      if (!project) {
        unmapped += duration;
        intervals.push({ key: null, timestamp, duration });
        continue;
      }
      const key = `${day.date}\u0000${project.project_alias}`;
      const group = assigned.get(key) || {
        project,
        sourceDurationSeconds: 0,
        bridgedGapSeconds: 0,
        rulePaths: new Map<string, string[]>(),
        exactMappings: 0,
        inheritedMappings: 0,
      };
      group.sourceDurationSeconds += duration;
      group.rulePaths.set(JSON.stringify(rule.category_path), [...rule.category_path]);
      if (rule.category_path.length === category.length) group.exactMappings += 1;
      else group.inheritedMappings += 1;
      assigned.set(key, group);
      intervals.push({ key, timestamp, duration });
    }
    intervals.sort((left, right) => left.timestamp - right.timestamp);
    for (let index = 1; index < intervals.length; index++) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (!current.key || current.key !== previous.key) continue;
      const gap = (current.timestamp - (previous.timestamp + previous.duration * 1000)) / 1000;
      if (gap > 0 && gap <= breakTimeSeconds) {
        assigned.get(current.key)!.bridgedGapSeconds += gap;
      }
    }
  }

  const lines = [...assigned.entries()].map(([key, group]) => {
    const [date, project_alias] = key.split('\u0000');
    const rawSeconds = Math.round(group.sourceDurationSeconds + group.bridgedGapSeconds);
    const approved_duration_seconds = roundFreelancerDuration(
      rawSeconds, group.project.rounding_increment_seconds, group.project.rounding_mode,
    );
    if (approved_duration_seconds === 0) {
      unmapped += rawSeconds;
      return null;
    }
    return {
      project_alias,
      date,
      source_duration_seconds: rawSeconds,
      approved_duration_seconds,
      billable: group.project.billable_default,
      rounding_increment_seconds: group.project.rounding_increment_seconds,
      rounding_mode: group.project.rounding_mode,
      mapping_rule_paths: [...group.rulePaths.values()]
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      mapping_confidence: group.exactMappings && group.inheritedMappings
        ? 'mixed'
        : group.inheritedMappings ? 'inherited' : 'exact',
    };
  }).filter((line): line is ProjectTimesheetLineV1 => line !== null)
    .sort((left, right) => left.date.localeCompare(right.date) || left.project_alias.localeCompare(right.project_alias));

  const secondsByDate = new Map<string, number>();
  for (const line of lines) {
    const total = (secondsByDate.get(line.date) || 0) + line.approved_duration_seconds;
    if (total > APPROVED_TIMESHEET_MAX_SECONDS_PER_DAY_V1) {
      throw new TypeError('Project rounding would exceed 24 hours for a local day.');
    }
    secondsByDate.set(line.date, total);
  }

  return {
    lines,
    unmapped_duration_seconds: Math.round(unmapped),
    nonbillable_duration_seconds: lines.filter(line => !line.billable)
      .reduce((sum, line) => sum + line.source_duration_seconds, 0),
  };
}

export interface ProjectProfitabilityV1 {
  project_alias: string;
  currency_code: string | null;
  billable_duration_seconds: number;
  nonbillable_duration_seconds: number;
  income_minor: number | null;
  cost_minor: number | null;
  margin_minor: number | null;
}

function csvCell(value: string | number | null): string {
  if (typeof value === 'number') return String(value);
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function summarizeProjectProfitability(
  lines: ProjectTimesheetLineV1[],
  workspace: FreelancerWorkspaceV1,
): ProjectProfitabilityV1[] {
  const projects = new Map(workspace.projects.map(project => [project.project_alias, project]));
  const totals = new Map<string, ProjectProfitabilityV1>();
  for (const line of lines) {
    const project = projects.get(line.project_alias);
    if (!project) throw new TypeError('A timesheet line references a missing project.');
    const row = totals.get(line.project_alias) || {
      project_alias: line.project_alias,
      currency_code: project.currency_code,
      billable_duration_seconds: 0,
      nonbillable_duration_seconds: 0,
      income_minor: project.hourly_rate_minor === null ? null : 0,
      cost_minor: project.hourly_cost_minor === null ? null : 0,
      margin_minor: null,
    };
    if (line.billable) {
      row.billable_duration_seconds += line.approved_duration_seconds;
      if (row.income_minor !== null) {
        row.income_minor += calculateInvoiceSubtotalMinor(project.hourly_rate_minor!, line.approved_duration_seconds);
      }
    } else {
      row.nonbillable_duration_seconds += line.approved_duration_seconds;
    }
    if (row.cost_minor !== null) {
      row.cost_minor += calculateInvoiceSubtotalMinor(project.hourly_cost_minor!, line.approved_duration_seconds);
    }
    if (!Number.isSafeInteger(row.income_minor ?? 0) || !Number.isSafeInteger(row.cost_minor ?? 0)) {
      throw new TypeError('The local project estimate exceeds the supported amount.');
    }
    row.margin_minor = row.income_minor === null || row.cost_minor === null
      ? null
      : row.income_minor - row.cost_minor;
    totals.set(line.project_alias, row);
  }
  return [...totals.values()].sort((left, right) => left.project_alias.localeCompare(right.project_alias));
}

export function serializeProjectProfitabilityCsv(rows: ProjectProfitabilityV1[]): string {
  return [
    ['project_alias', 'currency_code', 'billable_duration_seconds', 'nonbillable_duration_seconds', 'income_minor', 'cost_minor', 'margin_minor'],
    ...rows.map(row => [
      row.project_alias, row.currency_code, row.billable_duration_seconds,
      row.nonbillable_duration_seconds, row.income_minor, row.cost_minor, row.margin_minor,
    ]),
  ].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export interface ApprovedTimesheetV1 {
  schema_version: typeof APPROVED_TIMESHEET_SCHEMA_VERSION_V1;
  project_alias: string;
  date: string;
  approved_duration_seconds: number;
  user_note: string | null;
}

export interface SignedClientReportV1 {
  schema_version: 1;
  timesheet: ApprovedTimesheetV1;
  artifact_sha256: string;
  signer_public_key_ed25519: string;
  signature_ed25519: string;
}

export interface ApprovedTimesheetInputV1 {
  project_alias: string;
  date: string;
  approved_duration_seconds: number;
  user_note?: string | null;
}

function normalizeTimesheetInput(
  input: ApprovedTimesheetInputV1 | ApprovedTimesheetV1,
): ApprovedTimesheetInputV1 {
  const fields = ['project_alias', 'date', 'approved_duration_seconds', 'user_note'];
  const allowed = new Set([...fields, 'schema_version']);
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !allowed.has(key))
      || ('schema_version' in input && input.schema_version !== APPROVED_TIMESHEET_SCHEMA_VERSION_V1)) {
    throw new TypeError('Approved Timesheet contains unsupported fields.');
  }
  return {
    project_alias: input.project_alias,
    date: input.date,
    approved_duration_seconds: input.approved_duration_seconds,
    user_note: input.user_note,
  };
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function buildApprovedTimesheet(input: ApprovedTimesheetInputV1): ApprovedTimesheetV1 {
  const fields = ['project_alias', 'date', 'approved_duration_seconds', 'user_note'];
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !fields.includes(key))) {
    throw new TypeError('Approved Timesheet contains unsupported fields.');
  }
  if (typeof input.project_alias !== 'string'
      || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(input.project_alias)) {
    throw new TypeError('Choose a valid project alias.');
  }
  if (typeof input.date !== 'string' || !isIsoDate(input.date)) {
    throw new TypeError('Choose a valid timesheet date.');
  }
  if (!Number.isSafeInteger(input.approved_duration_seconds)
      || input.approved_duration_seconds <= 0
      || input.approved_duration_seconds > APPROVED_TIMESHEET_MAX_SECONDS_PER_DAY_V1) {
    throw new TypeError('Approved daily time must be between zero and 24 hours.');
  }
  const note = input.user_note ?? null;
  if (note !== null && (typeof note !== 'string'
      || new TextEncoder().encode(note).length > APPROVED_TIMESHEET_MAX_NOTE_BYTES_V1
      || /[\u0000-\u001f\u007f]/.test(note))) {
    throw new TypeError('The user note is invalid or too long.');
  }
  return {
    schema_version: APPROVED_TIMESHEET_SCHEMA_VERSION_V1,
    project_alias: input.project_alias,
    date: input.date,
    approved_duration_seconds: input.approved_duration_seconds,
    user_note: note,
  };
}

export function serializeApprovedTimesheet(
  input: ApprovedTimesheetInputV1 | ApprovedTimesheetV1,
): string {
  const timesheet = buildApprovedTimesheet(normalizeTimesheetInput(input));
  return JSON.stringify({
    approved_duration_seconds: timesheet.approved_duration_seconds,
    date: timesheet.date,
    project_alias: timesheet.project_alias,
    schema_version: timesheet.schema_version,
    user_note: timesheet.user_note,
  });
}

export function isExactApprovedTimesheetPayload(
  approved: ApprovedTimesheetInputV1 | ApprovedTimesheetV1,
  candidate: unknown,
): boolean {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.keys(candidate).length !== 5) return false;
  try {
    return serializeApprovedTimesheet(candidate as ApprovedTimesheetV1)
      === serializeApprovedTimesheet(approved);
  } catch (_) {
    return false;
  }
}

export function serializeApprovedTimesheetCsv(
  input: ApprovedTimesheetInputV1 | ApprovedTimesheetV1,
): string {
  const timesheet = buildApprovedTimesheet(normalizeTimesheetInput(input));
  return [
    ['project_alias', 'date', 'approved_duration_seconds', 'user_note'],
    [timesheet.project_alias, timesheet.date, timesheet.approved_duration_seconds, timesheet.user_note],
  ].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function roundFreelancerDuration(
  seconds: number,
  incrementSeconds: number,
  mode: FreelancerRoundingModeV1
): number {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > APPROVED_TIMESHEET_MAX_SECONDS_PER_DAY_V1) {
    throw new TypeError('Daily duration is outside the supported range.');
  }
  if (mode === 'none') {
    if (incrementSeconds !== 0) throw new TypeError('Rounding increment must be zero when rounding is off.');
    return seconds;
  }
  if (!['up', 'down', 'nearest'].includes(mode)
      || !Number.isInteger(incrementSeconds) || incrementSeconds < 1 || incrementSeconds > 3_600) {
    throw new TypeError('Rounding increment must be between one second and one hour.');
  }
  const rounded = mode === 'up'
    ? Math.ceil(seconds / incrementSeconds) * incrementSeconds
    : mode === 'down'
    ? Math.floor(seconds / incrementSeconds) * incrementSeconds
    : Math.floor((seconds + Math.floor(incrementSeconds / 2)) / incrementSeconds) * incrementSeconds;
  if (!Number.isSafeInteger(rounded) || rounded > APPROVED_TIMESHEET_MAX_SECONDS_PER_DAY_V1) {
    throw new TypeError('Rounded daily duration exceeds 24 hours.');
  }
  return rounded;
}

export function calculateInvoiceSubtotalMinor(hourlyRateMinor: number, seconds: number): number {
  if (!Number.isSafeInteger(hourlyRateMinor) || hourlyRateMinor < 0
      || hourlyRateMinor > FREELANCER_MAX_SAFE_MINOR_UNITS_V1
      || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 31 * 86_400) {
    throw new TypeError('The local invoice rate or duration is invalid.');
  }
  const wholeRate = Math.floor(hourlyRateMinor / 3600);
  const remainder = hourlyRateMinor % 3600;
  if (seconds !== 0 && wholeRate > Math.floor(FREELANCER_MAX_SAFE_MINOR_UNITS_V1 / seconds)) {
    throw new TypeError('The local invoice amount exceeds the supported range.');
  }
  const wholeAmount = wholeRate * seconds;
  const fractionalAmount = Math.floor((remainder * seconds + 1800) / 3600);
  const subtotal = wholeAmount + fractionalAmount;
  if (!Number.isSafeInteger(subtotal) || subtotal > FREELANCER_MAX_SAFE_MINOR_UNITS_V1) {
    throw new TypeError('The local invoice amount exceeds the supported range.');
  }
  return subtotal;
}

export interface InvoiceDraftInputV1 {
  project_alias: string;
  period_start: string;
  period_end: string;
  currency_code: string;
  approved_duration_seconds: number;
  hourly_rate_minor: number;
}

export interface InvoiceDraftV1 extends InvoiceDraftInputV1 {
  schema_version: 1;
  subtotal_minor: number;
  status: 'draft';
  tax_status: 'not_calculated';
}

export function buildInvoiceDraft(input: InvoiceDraftInputV1): InvoiceDraftV1 {
  const fields = [
    'project_alias', 'period_start', 'period_end', 'currency_code',
    'approved_duration_seconds', 'hourly_rate_minor',
  ];
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !fields.includes(key))) {
    throw new TypeError('Invoice draft contains unsupported fields.');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(input.project_alias)
      || !isIsoDate(input.period_start) || !isIsoDate(input.period_end)
      || input.period_start > input.period_end
      || (Date.parse(`${input.period_end}T00:00:00.000Z`)
        - Date.parse(`${input.period_start}T00:00:00.000Z`)) / 86_400_000 >= 31
      || !/^[A-Z]{3}$/.test(input.currency_code)
      || !Number.isSafeInteger(input.approved_duration_seconds)
      || input.approved_duration_seconds <= 0
      || input.approved_duration_seconds > 31 * 86_400) {
    throw new TypeError('The local invoice draft is invalid.');
  }
  const subtotal_minor = calculateInvoiceSubtotalMinor(
    input.hourly_rate_minor, input.approved_duration_seconds,
  );
  return {
    schema_version: 1,
    project_alias: input.project_alias,
    period_start: input.period_start,
    period_end: input.period_end,
    currency_code: input.currency_code,
    approved_duration_seconds: input.approved_duration_seconds,
    hourly_rate_minor: input.hourly_rate_minor,
    subtotal_minor,
    status: 'draft',
    tax_status: 'not_calculated',
  };
}
