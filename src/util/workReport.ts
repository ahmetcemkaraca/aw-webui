import { IBucket } from '~/util/interfaces';
import moment from 'moment';
import type { AxiosInstance } from 'axios';
import { get_day_end_with_offset, get_day_start_with_offset } from '~/util/time';
import { bridgeGaps } from './bridgeGaps.js';
export { bridgeGaps } from './bridgeGaps.js';

export const WORK_REPORT_METHOD_ID = 'work-time-report';
export const WORK_REPORT_METHOD_VERSION = 1;
export const WORK_REPORT_AGGREGATE_METHOD_ID = 'work-time-calendar-aggregate';
export const WORK_REPORT_AGGREGATE_METHOD_VERSION = 1;
export const WORK_REPORT_COMPARISON_METHOD_ID = 'work-time-period-comparison';
export const WORK_REPORT_COMPARISON_METHOD_VERSION = 1;
export const WORK_REPORT_FIELD_SUMMARY_METHOD_ID = 'work-time-field-summary';
export const WORK_REPORT_FIELD_SUMMARY_METHOD_VERSION = 1;
export const FOCUS_BLOCK_METHOD_ID = 'focus-blocks';
export const FOCUS_BLOCK_METHOD_VERSION = 1;
export const CONTEXT_SWITCH_METHOD_ID = 'context-switches';
export const CONTEXT_SWITCH_METHOD_VERSION = 1;
export const MEETING_LOAD_METHOD_ID = 'meeting-load';
export const MEETING_LOAD_METHOD_VERSION = 1;
export const WORK_REPORT_SOURCE_COVERAGE_METHOD_ID = 'work-report-source-coverage';
export const WORK_REPORT_SOURCE_COVERAGE_METHOD_VERSION = 1;
export const WORK_REPORT_MAX_QUERY_PERIODS = 62;
export const WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD = 1000;
export const WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD = 2000;

// ponytail: fixed thresholds keep metrics reproducible; make them configurable only if device acceptance shows they misfit.
const FOCUS_MINIMUM_SECONDS = 25 * 60;
const FOCUS_MAXIMUM_GAP_SECONDS = 5 * 60;
const CONTEXT_SWITCH_MAXIMUM_GAP_SECONDS = 60;
const MEETING_MINIMUM_SECONDS = 5 * 60;

export interface DailyWorkReportV1 {
  date: string;
  duration: number;
  sessions: number;
  avgSession: number;
  events: any[];
}

export interface WorkReportCalculationManifestV1 {
  schema_version: 1;
  method_id: string;
  method_version: number;
  formula: string;
  input_periods: string[];
  host_ids: string[];
  category_paths: string[][];
  date_range: string;
  start_of_day: string;
  break_time_seconds: number;
  coverage: {
    requested_periods: number;
    periods_with_events: number;
    events_seen: number;
    source_health: 'unknown';
    limitation: string;
  };
}

export interface WorkReportCalculationOptionsV1 {
  hostIds: string[];
  categoryPaths: string[][];
  dateRange: string;
  startOfDay: string;
}

export interface WorkReportWindowsV1 {
  current: string[];
  previous: string[] | null;
  partial_periods: string[];
  limited_periods: string[];
  source_row_limit: number;
  report_row_limit: number;
}

export interface WorkReportSourceCoverageV1 {
  method_id: string;
  method_version: number;
  available_source_buckets: string[];
  queried_source_buckets: string[];
  queried_periods: string[];
  partial_periods: string[];
  timezone: string;
  source_health: 'unknown';
  clock_skew: {
    status: 'unknown' | 'not_applicable';
    correction_bound_seconds: 0;
    limitation: string;
  };
}

export interface WorkReportAggregateV1 {
  method_id: string;
  method_version: number;
  unit: 'week' | 'month';
  period: string;
  start_date: string;
  end_date: string;
  days: number;
  days_with_events: number;
  duration: number;
  sessions: number;
}

export interface WorkReportPeriodSummaryV1 {
  start_date: string;
  end_date: string;
  periods: number;
  periods_with_events: number;
  observed_events: number;
  duration: number;
}

export interface WorkReportComparisonV1 {
  method_id: string;
  method_version: number;
  current: WorkReportPeriodSummaryV1;
  previous: WorkReportPeriodSummaryV1;
  duration_change: number;
  duration_change_percent: number | null;
  coverage_note: string | null;
}

export interface WorkReportFieldSummaryV1 {
  method_id: string;
  method_version: number;
  project: { label: string; duration: number; sessions: number }[];
  app: { label: string; duration: number; sessions: number }[];
  domain: { label: string; duration: number; sessions: number }[];
  active_away: { active_duration: number; away_duration: number } | null;
}

export interface WorkReportFocusBlocksV1 {
  method_id: string;
  method_version: number;
  outcome: 'calculated' | 'could_not_determine';
  thresholds: { minimum_duration_seconds: number; maximum_gap_seconds: number };
  intervals: { start: string; end: string; duration_seconds: number }[];
  reason?: string;
}

export interface WorkReportContextSwitchesV1 {
  method_id: string;
  method_version: number;
  outcome: 'calculated' | 'could_not_determine';
  thresholds: { maximum_gap_seconds: number };
  intervals: {
    start: string;
    end: string;
    gap_seconds: number;
    from_app: string;
    to_app: string;
  }[];
  reason?: string;
}

export interface WorkReportMeetingLoadV1 {
  method_id: string;
  method_version: number;
  outcome: 'calculated' | 'could_not_determine';
  thresholds: { minimum_interval_seconds: number };
  duration_seconds: number;
  intervals: { start: string; end: string; duration_seconds: number }[];
  reason?: string;
}

interface TimedWorkEvent {
  date: string;
  start: number;
  end: number;
  event: any;
}

function timedWorkEvents(daily: DailyWorkReportV1[]): TimedWorkEvent[] | null {
  if (!Array.isArray(daily)) return null;
  const events: TimedWorkEvent[] = [];
  for (const day of daily) {
    if (!moment.utc(day.date, 'YYYY-MM-DD', true).isValid() || !Array.isArray(day.events)) {
      return null;
    }
    for (const event of day.events) {
      const start = Date.parse(event?.timestamp);
      const duration = event?.duration;
      const end = start + duration * 1000;
      if (
        !Number.isFinite(start) ||
        typeof duration !== 'number' ||
        !Number.isFinite(duration) ||
        duration < 0 ||
        !Number.isFinite(end)
      )
        return null;
      events.push({ date: day.date, start, end, event });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

function utcInterval(start: number, end: number) {
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    duration_seconds: (end - start) / 1000,
  };
}

export function calculateFocusBlocks(daily: DailyWorkReportV1[]): WorkReportFocusBlocksV1 {
  const base = {
    method_id: FOCUS_BLOCK_METHOD_ID,
    method_version: FOCUS_BLOCK_METHOD_VERSION,
    thresholds: {
      minimum_duration_seconds: FOCUS_MINIMUM_SECONDS,
      maximum_gap_seconds: FOCUS_MAXIMUM_GAP_SECONDS,
    },
  };
  const events = timedWorkEvents(daily);
  if (!events || !events.length) {
    return {
      ...base,
      outcome: 'could_not_determine',
      intervals: [],
      reason: 'No valid observed event intervals are available; capture coverage is unknown.',
    };
  }

  const intervals: WorkReportFocusBlocksV1['intervals'] = [];
  let block: { date: string; start: number; end: number } | null = null;
  const addBlock = () => {
    if (block && (block.end - block.start) / 1000 >= FOCUS_MINIMUM_SECONDS) {
      intervals.push(utcInterval(block.start, block.end));
    }
  };
  for (const event of events) {
    const gapSeconds = block ? (event.start - block.end) / 1000 : Infinity;
    if (block && block.date === event.date && gapSeconds <= FOCUS_MAXIMUM_GAP_SECONDS) {
      block.end = Math.max(block.end, event.end);
    } else {
      addBlock();
      block = { date: event.date, start: event.start, end: event.end };
    }
  }
  addBlock();
  return { ...base, outcome: 'calculated', intervals };
}

export function calculateContextSwitches(daily: DailyWorkReportV1[]): WorkReportContextSwitchesV1 {
  const base = {
    method_id: CONTEXT_SWITCH_METHOD_ID,
    method_version: CONTEXT_SWITCH_METHOD_VERSION,
    thresholds: { maximum_gap_seconds: CONTEXT_SWITCH_MAXIMUM_GAP_SECONDS },
  };
  const events = timedWorkEvents(daily);
  if (
    !events ||
    events.length < 2 ||
    events.some(event => typeof event.event?.data?.app !== 'string' || !event.event.data.app.trim())
  ) {
    return {
      ...base,
      outcome: 'could_not_determine',
      intervals: [],
      reason: 'At least two observed events with application names are required.',
    };
  }

  const intervals: WorkReportContextSwitchesV1['intervals'] = [];
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1];
    const current = events[index];
    const gapSeconds = (current.start - previous.end) / 1000;
    const fromApp = previous.event.data.app.trim();
    const toApp = current.event.data.app.trim();
    if (
      previous.date === current.date &&
      gapSeconds >= 0 &&
      gapSeconds <= CONTEXT_SWITCH_MAXIMUM_GAP_SECONDS &&
      fromApp &&
      toApp &&
      fromApp !== toApp
    ) {
      intervals.push({
        start: new Date(previous.end).toISOString(),
        end: new Date(current.start).toISOString(),
        gap_seconds: gapSeconds,
        from_app: fromApp,
        to_app: toApp,
      });
    }
  }
  return { ...base, outcome: 'calculated', intervals };
}

export function calculateMeetingLoad(
  daily: DailyWorkReportV1[],
  categoryPaths: string[][]
): WorkReportMeetingLoadV1 {
  const base = {
    method_id: MEETING_LOAD_METHOD_ID,
    method_version: MEETING_LOAD_METHOD_VERSION,
    thresholds: { minimum_interval_seconds: MEETING_MINIMUM_SECONDS },
  };
  const meetingPaths = categoryPaths.filter(path =>
    path.some(segment => ['meeting', 'meetings'].includes(segment.trim().toLowerCase()))
  );
  const events = timedWorkEvents(daily);
  if (
    !meetingPaths.length ||
    !events?.length ||
    events.some(
      event =>
        !Array.isArray(event.event?.data?.$category) ||
        event.event.data.$category.some((segment: unknown) => typeof segment !== 'string')
    )
  ) {
    return {
      ...base,
      outcome: 'could_not_determine',
      duration_seconds: 0,
      intervals: [],
      reason: meetingPaths.length
        ? 'A meeting category and observed categorized events are required.'
        : 'Select a category path with a Meeting segment; meeting labels are never inferred.',
    };
  }

  const intervals = events
    .filter(event => {
      const category = event.event.data.$category.map((segment: unknown) =>
        typeof segment === 'string' ? segment.trim().toLowerCase() : ''
      );
      return (
        category.some((segment: string) => segment === 'meeting' || segment === 'meetings') &&
        (event.end - event.start) / 1000 >= MEETING_MINIMUM_SECONDS
      );
    })
    .map(event => utcInterval(event.start, event.end));
  return {
    ...base,
    outcome: 'calculated',
    duration_seconds: intervals.reduce((sum, interval) => sum + interval.duration_seconds, 0),
    intervals,
  };
}

export function buildWorkReportWindows(
  dateRange: string,
  startOfDay: string,
  now: moment.Moment = moment()
): WorkReportWindowsV1 {
  const [hour, minute, ...extra] = startOfDay.split(':').map(Number);
  if (
    extra.length ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !now.isValid()
  ) {
    throw new TypeError('Work Report local day start or current time is invalid.');
  }
  const boundary = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
  if (now.isBefore(boundary)) boundary.subtract(1, 'day');
  const today = boundary.clone().startOf('day');
  const partialPeriods = now.isAfter(boundary) ? [today.format('YYYY-MM-DD')] : [];
  let currentStart: moment.Moment;
  let days: number;
  let previousStart: moment.Moment | null;

  if (dateRange === 'thisWeek') {
    currentStart = today.clone().startOf('isoWeek');
    days = today.diff(currentStart, 'days') + 1;
    previousStart = currentStart.clone().subtract(7, 'days');
  } else if (dateRange === 'thisMonth') {
    currentStart = today.clone().startOf('month');
    days = today.date();
    const priorMonth = currentStart.clone().subtract(1, 'month');
    previousStart = priorMonth.daysInMonth() >= days ? priorMonth : null;
  } else {
    days = dateRange === 'last30d' ? 30 : 7;
    currentStart = today.clone().subtract(days - 1, 'days');
    previousStart = currentStart.clone().subtract(days, 'days');
  }

  const periodsFor = (start: moment.Moment | null): string[] | null => {
    if (!start) return null;
    return Array.from({ length: days }, (_, index) => {
      const date = start.clone().add(index, 'days');
      return `${get_day_start_with_offset(date, startOfDay)}/${get_day_end_with_offset(
        date,
        startOfDay
      )}`;
    });
  };

  return {
    current: periodsFor(currentStart) || [],
    previous: periodsFor(previousStart),
    partial_periods: partialPeriods,
  };
}

export function buildWorkReportSourceCoverage(options: {
  availableSourceBuckets: string[];
  queriedSourceBuckets: string[];
  queriedPeriods: string[];
  partialPeriods: string[];
  limitedPeriods: string[];
  timezone: string;
  deviceCount: number;
}): WorkReportSourceCoverageV1 {
  const multiDevice = options.deviceCount > 1;
  return {
    method_id: WORK_REPORT_SOURCE_COVERAGE_METHOD_ID,
    method_version: WORK_REPORT_SOURCE_COVERAGE_METHOD_VERSION,
    available_source_buckets: [...new Set(options.availableSourceBuckets)].sort(),
    queried_source_buckets: [...new Set(options.queriedSourceBuckets)].sort(),
    queried_periods: [...options.queriedPeriods],
    partial_periods: [...options.partialPeriods],
    limited_periods: [...options.limitedPeriods],
    source_row_limit: WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD,
    report_row_limit: WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD,
    timezone: options.timezone,
    source_health: 'unknown',
    clock_skew: {
      status: multiDevice ? 'unknown' : 'not_applicable',
      correction_bound_seconds: 0,
      limitation: multiDevice
        ? 'No device clock correction is applied; multi-device alignment is unknown.'
        : 'No cross-device clock correction is applied.',
    },
  };
}

export function getLimitedWorkReportPeriods(results: any[], periods: string[]): string[] {
  return periods.filter((_period, index) => {
    const result = results[index];
    const reportCount = Number(result?.report_event_count);
    const sourceCounts = Array.isArray(result?.source_event_counts)
      ? result.source_event_counts
      : [];
    return (
      reportCount > WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD ||
      sourceCounts.some(
        (count: unknown) => Number(count) > WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD
      )
    );
  });
}

export function isWorkReportCancelled(error: any): boolean {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
}

export async function queryWorkReport(
  client: { req: AxiosInstance },
  query: string,
  timeperiods: string[],
  signal: AbortSignal
): Promise<any[]> {
  const response = await client.req.post('/0/query/', { query: [query], timeperiods }, { signal });
  return response.data;
}

function orderedDays(daily: DailyWorkReportV1[]): DailyWorkReportV1[] | null {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (
    sorted.some(
      (day, index) =>
        !moment.utc(day.date, 'YYYY-MM-DD', true).isValid() ||
        (index > 0 && sorted[index - 1].date === day.date)
    )
  )
    return null;
  return sorted;
}

function datesAreSequential(daily: DailyWorkReportV1[]): boolean {
  return daily.every(
    (day, index) =>
      index === 0 || moment.utc(day.date).diff(moment.utc(daily[index - 1].date), 'days') === 1
  );
}

export function aggregateDailyWorkReport(
  daily: DailyWorkReportV1[],
  unit: 'week' | 'month'
): WorkReportAggregateV1[] {
  const sorted = orderedDays(daily);
  if (!sorted || !datesAreSequential(sorted)) {
    throw new TypeError('Work Report calendar totals require unique, sequential local dates.');
  }

  const groups = new Map<string, WorkReportAggregateV1>();
  for (const day of sorted) {
    const date = moment.utc(day.date, 'YYYY-MM-DD', true);
    const period = unit === 'week' ? date.format('GGGG-[W]WW') : date.format('YYYY-MM');
    const group = groups.get(period) || {
      method_id: WORK_REPORT_AGGREGATE_METHOD_ID,
      method_version: WORK_REPORT_AGGREGATE_METHOD_VERSION,
      unit,
      period,
      start_date: day.date,
      end_date: day.date,
      days: 0,
      days_with_events: 0,
      duration: 0,
      sessions: 0,
    };
    group.end_date = day.date;
    group.days += 1;
    group.days_with_events += day.sessions > 0 ? 1 : 0;
    group.sessions += day.sessions;
    group.duration += day.duration;
    groups.set(period, group);
  }
  return [...groups.values()];
}

export function compareWorkReportPeriods(
  current: DailyWorkReportV1[],
  previous: DailyWorkReportV1[]
): WorkReportComparisonV1 | null {
  const currentDays = orderedDays(current);
  const previousDays = orderedDays(previous);
  if (
    !currentDays ||
    !previousDays ||
    !currentDays.length ||
    currentDays.length !== previousDays.length ||
    !datesAreSequential(currentDays) ||
    !datesAreSequential(previousDays) ||
    previousDays[previousDays.length - 1].date >= currentDays[0].date
  )
    return null;

  const summarize = (days: DailyWorkReportV1[]) => ({
    start_date: days[0].date,
    end_date: days[days.length - 1].date,
    periods: days.length,
    periods_with_events: days.filter(day => day.sessions > 0).length,
    observed_events: days.reduce((sum, day) => sum + day.sessions, 0),
    duration: days.reduce((sum, day) => sum + day.duration, 0),
  });
  const currentSummary = summarize(currentDays);
  const previousSummary = summarize(previousDays);
  const durationChange = currentSummary.duration - previousSummary.duration;
  const coverageNote =
    currentSummary.observed_events < previousSummary.observed_events
      ? `Current period has fewer observed events (${currentSummary.observed_events} vs ${previousSummary.observed_events}).`
      : previousSummary.observed_events < currentSummary.observed_events
      ? `Previous period has fewer observed events (${previousSummary.observed_events} vs ${currentSummary.observed_events}).`
      : null;

  return {
    method_id: WORK_REPORT_COMPARISON_METHOD_ID,
    method_version: WORK_REPORT_COMPARISON_METHOD_VERSION,
    current: currentSummary,
    previous: previousSummary,
    duration_change: durationChange,
    duration_change_percent:
      previousSummary.duration > 0 ? (durationChange / previousSummary.duration) * 100 : null,
    coverage_note: coverageNote,
  };
}

export function summarizeWorkReportFields(daily: DailyWorkReportV1[]): WorkReportFieldSummaryV1 {
  const summaries = {
    project: new Map<string, { duration: number; sessions: number }>(),
    app: new Map<string, { duration: number; sessions: number }>(),
    domain: new Map<string, { duration: number; sessions: number }>(),
  };
  let activeDuration = 0;
  let awayDuration = 0;
  let eventsSeen = 0;
  let eventsWithStatus = 0;

  const add = (field: keyof typeof summaries, value: unknown, duration: number) => {
    if (typeof value !== 'string' || !value) return;
    const summary = summaries[field].get(value) || { duration: 0, sessions: 0 };
    summary.duration += duration;
    summary.sessions += 1;
    summaries[field].set(value, summary);
  };

  for (const day of daily) {
    for (const event of day.events) {
      const data = event?.data;
      const duration = event?.duration;
      if (!data || typeof data !== 'object' || !Number.isFinite(duration) || duration < 0) continue;
      eventsSeen += 1;
      add('project', data.project, duration);
      add('app', data.app, duration);
      const candidate = typeof data.domain === 'string' ? data.domain : data.url;
      if (typeof candidate === 'string') {
        try {
          const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
          add('domain', url.hostname.toLowerCase(), duration);
        } catch (_) {
          /* Unparseable URLs do not produce a domain summary. */
        }
      }
      if (typeof data.status === 'string') {
        const activityStatus = data.status.toLowerCase();
        if (activityStatus === 'active' || activityStatus === 'not-afk') {
          activeDuration += duration;
          eventsWithStatus += 1;
        } else if (
          activityStatus === 'afk' ||
          activityStatus === 'away' ||
          activityStatus === 'idle'
        ) {
          awayDuration += duration;
          eventsWithStatus += 1;
        }
      }
    }
  }

  const rows = (values: Map<string, { duration: number; sessions: number }>) =>
    [...values.entries()]
      .map(([label, summary]) => ({ label, ...summary }))
      .sort((a, b) => b.duration - a.duration || a.label.localeCompare(b.label));

  return {
    method_id: WORK_REPORT_FIELD_SUMMARY_METHOD_ID,
    method_version: WORK_REPORT_FIELD_SUMMARY_METHOD_VERSION,
    project: rows(summaries.project),
    app: rows(summaries.app),
    domain: rows(summaries.domain),
    active_away:
      eventsSeen > 0 && eventsWithStatus === eventsSeen
        ? { active_duration: activeDuration, away_duration: awayDuration }
        : null,
  };
}

export function calculateDailyWorkReport(
  periods: string[],
  results: any[],
  breakTimeSeconds: number,
  options: WorkReportCalculationOptionsV1
): { daily: DailyWorkReportV1[]; manifest: WorkReportCalculationManifestV1 } {
  if (!Number.isFinite(breakTimeSeconds) || breakTimeSeconds < 0) {
    throw new TypeError('Work Report break time must be a non-negative number.');
  }
  if (periods.length !== results.length) {
    throw new TypeError('Work Report requires one query result for each input period.');
  }

  const daily = periods.map((period, index) => {
    const [start, end, ...extra] = period.split('/');
    const startMoment = moment.parseZone(start);
    const endMoment = moment.parseZone(end);
    if (
      extra.length ||
      !startMoment.isValid() ||
      !endMoment.isValid() ||
      !endMoment.isAfter(startMoment)
    )
      throw new TypeError('Work Report input period has an invalid start time.');
    const result = results[index] || {};
    const events = result.events ?? [];
    if (!Array.isArray(events)) throw new TypeError('Work Report events must be an array.');
    const baseDuration = result.duration ?? 0;
    if (typeof baseDuration !== 'number' || !Number.isFinite(baseDuration) || baseDuration < 0) {
      throw new TypeError('Work Report query duration must be a non-negative number.');
    }
    const duration = baseDuration + bridgeGaps(events, breakTimeSeconds);
    return {
      date: startMoment.format('YYYY-MM-DD'),
      duration,
      sessions: events.length,
      avgSession: events.length > 0 ? duration / events.length : 0,
      events,
    };
  });

  return {
    daily,
    manifest: {
      schema_version: 1,
      method_id: WORK_REPORT_METHOD_ID,
      method_version: WORK_REPORT_METHOD_VERSION,
      formula: 'query duration plus positive adjacent gaps no greater than the selected break time',
      input_periods: [...periods],
      host_ids: [...options.hostIds],
      category_paths: options.categoryPaths.map(path => [...path]),
      date_range: options.dateRange,
      start_of_day: options.startOfDay,
      break_time_seconds: breakTimeSeconds,
      coverage: {
        requested_periods: periods.length,
        periods_with_events: daily.filter(day => day.events.length > 0).length,
        events_seen: daily.reduce((count, day) => count + day.events.length, 0),
        source_health: 'unknown',
        limitation: 'An empty period cannot distinguish no activity from missing capture.',
      },
    },
  };
}

export function buildWorkReportJsonExport(
  report: Record<string, any>,
  rawEvents: any[],
  includeRawEvents: boolean
): Record<string, any> {
  const safeReport = { ...report };
  delete safeReport.rawEvents;
  const daily = Array.isArray(safeReport.daily)
    ? safeReport.daily.map(({ events: _events, ...day }: DailyWorkReportV1) => day)
    : safeReport.daily;
  return {
    ...safeReport,
    daily,
    ...(includeRawEvents ? { rawEvents } : {}),
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildWorkReportCsv(
  daily: DailyWorkReportV1[],
  summary: { totalDuration: number; totalSessions: number; avgSessionLength: number },
  metadata: Record<string, unknown>
): string {
  const rows: unknown[][] = [
    ['Date', 'Duration (hours)', 'Sessions', 'Avg Session (minutes)'],
    ...daily.map(day => [
      day.date,
      (day.duration / 3600).toFixed(2),
      day.sessions,
      (day.avgSession / 60).toFixed(1),
    ]),
    [],
    [
      'Total',
      (summary.totalDuration / 3600).toFixed(2),
      summary.totalSessions,
      (summary.avgSessionLength / 60).toFixed(1),
    ],
    ['# PeakActivity manifest', JSON.stringify(metadata)],
  ];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export interface WorkReportHostOption {
  value: string;
  text: string;
  disabled: boolean;
}

function getWindowHosts(buckets: IBucket[]): string[] {
  const hosts = buckets
    .filter(bucket => bucket.type === 'currentwindow')
    .map(bucket => bucket.id.replace('aw-watcher-window_', ''));
  return [...new Set(hosts)];
}

function getAFKHosts(buckets: IBucket[]): Set<string> {
  return new Set(
    buckets
      .filter(bucket => bucket.type === 'afkstatus')
      .map(bucket => bucket.id.replace('aw-watcher-afk_', ''))
  );
}

export function getWorkReportHostOptions(buckets: IBucket[]): WorkReportHostOption[] {
  const afkHosts = getAFKHosts(buckets);
  return getWindowHosts(buckets).map(host => {
    const hasAFK = afkHosts.has(host);
    return {
      value: host,
      text: hasAFK ? host : `${host} (requires aw-watcher-afk)`,
      disabled: !hasAFK,
    };
  });
}

export function getUnsupportedWorkReportHosts(
  selectedHosts: string[],
  buckets: IBucket[]
): string[] {
  const afkHosts = getAFKHosts(buckets);
  return selectedHosts.filter(host => !afkHosts.has(host));
}

export function getSupportedWorkReportHosts(selectedHosts: string[], buckets: IBucket[]): string[] {
  const unsupportedHosts = new Set(getUnsupportedWorkReportHosts(selectedHosts, buckets));
  return selectedHosts.filter(host => !unsupportedHosts.has(host));
}

// Builds the aw-query string for the Work Time Report. Extracted from the
// component so the generated query can be snapshot-tested — that's how we
// catch arg-count regressions like flood(events, breakTime) which aw-query
// rejects with "Tried to call function flood with invalid amount of arguments".
export function buildWorkReportQuery(
  hosts: string[],
  categoriesStr: string,
  categoriesFilter: any[]
): string {
  let query = '';
  const sourceCounts: string[] = [];
  for (let hi = 0; hi < hosts.length; hi++) {
    const hostname = hosts[hi];
    sourceCounts.push(`window_source_count_${hi}`, `afk_source_count_${hi}`);
    query += `
            window_raw_${hi} = query_bucket("aw-watcher-window_${hostname}", ${
      WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD + 1
    });
            window_source_count_${hi} = event_count(window_raw_${hi});
            window_raw_${hi} = limit_events(window_raw_${hi}, ${WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD});
            window_raw_${hi} = sort_by_timestamp(window_raw_${hi});
            events_${hi} = flood(window_raw_${hi});
            afk_raw_${hi} = query_bucket("aw-watcher-afk_${hostname}", ${
      WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD + 1
    });
            afk_source_count_${hi} = event_count(afk_raw_${hi});
            afk_raw_${hi} = limit_events(afk_raw_${hi}, ${WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD});
            afk_raw_${hi} = sort_by_timestamp(afk_raw_${hi});
            not_afk_${hi} = flood(afk_raw_${hi});
            not_afk_${hi} = filter_keyvals(not_afk_${hi}, "status", ["not-afk"]);
            events_${hi} = filter_period_intersect(events_${hi}, not_afk_${hi});
          `;
  }
  query += '\nevents = [];';
  for (let hi = 0; hi < hosts.length; hi++) {
    query += `\nevents = union_no_overlap(events, events_${hi});`;
  }
  query += `
          events = sort_by_timestamp(events);
          report_event_count = event_count(events);
          events = limit_events(events, ${WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD});
          events = categorize(events, ${categoriesStr});
          events = filter_keyvals(events, "$category", ${JSON.stringify(categoriesFilter)});
          duration = sum_durations(events);
          source_event_counts = [${sourceCounts.join(', ')}];
          RETURN = {"events": events, "duration": duration, "source_event_counts": source_event_counts, "report_event_count": report_event_count};
        `;
  // Strip per-line trailing whitespace so the snapshot test stays stable
  // under the trailing-whitespace pre-commit hook. aw-query is whitespace-
  // tolerant so this has no runtime effect.
  return query
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .join('\n');
}
