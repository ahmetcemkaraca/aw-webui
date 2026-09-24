import {
  calculateDailyWorkReport,
  buildWorkReportQuery,
  buildWorkReportWindows,
  aggregateDailyWorkReport,
  compareWorkReportPeriods,
  summarizeWorkReportFields,
  buildWorkReportSourceCoverage,
  buildWorkReportJsonExport,
  buildWorkReportCsv,
  getLimitedWorkReportPeriods,
  isWorkReportCancelled,
  queryWorkReport,
  WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD,
  WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD,
  calculateFocusBlocks,
  calculateContextSwitches,
  calculateMeetingLoad,
  getSupportedWorkReportHosts,
  getUnsupportedWorkReportHosts,
  getWorkReportHostOptions,
} from '~/util/workReport';
import moment from 'moment';
import vector from '../vectors/work-report-v1.json';
import periodsVector from '../vectors/work-report-periods-v1.json';
import insightVector from '../vectors/work-report-insights-v1.json';
import timezoneVector from '../vectors/work-report-timezone-v1.json';

const buckets = [
  {
    id: 'aw-watcher-window_laptop',
    hostname: 'laptop',
    device_id: 'laptop',
    type: 'currentwindow',
    data: {},
  },
  {
    id: 'aw-watcher-afk_laptop',
    hostname: 'laptop',
    device_id: 'laptop',
    type: 'afkstatus',
    data: {},
  },
  {
    id: 'aw-watcher-window_phone',
    hostname: 'phone',
    device_id: 'phone',
    type: 'currentwindow',
    data: {},
  },
  {
    id: 'aw-watcher-afk_tablet',
    hostname: 'tablet',
    device_id: 'tablet',
    type: 'afkstatus',
    data: {},
  },
];

describe('workReport host helpers', () => {
  test('getWorkReportHostOptions disables hosts without AFK buckets', () => {
    expect(getWorkReportHostOptions(buckets as any)).toEqual([
      { value: 'laptop', text: 'laptop', disabled: false },
      { value: 'phone', text: 'phone (requires aw-watcher-afk)', disabled: true },
    ]);
  });

  test('does not offer an AFK-only device without a window source', () => {
    expect(getWorkReportHostOptions(buckets as any).map(option => option.value)).toEqual([
      'laptop',
      'phone',
    ]);
  });

  test('getUnsupportedWorkReportHosts returns selected hosts missing AFK buckets', () => {
    expect(getUnsupportedWorkReportHosts(['laptop', 'phone'], buckets as any)).toEqual(['phone']);
  });

  test('getSupportedWorkReportHosts returns only hosts with AFK buckets', () => {
    expect(getSupportedWorkReportHosts(['laptop', 'phone'], buckets as any)).toEqual(['laptop']);
  });

  test('buildWorkReportQuery uses single-arg flood() for both window and afk buckets', () => {
    // Regression: aw-query's flood() takes one argument. A previous version
    // passed breakTimeSeconds as a second argument, which made aw-server
    // respond with HTTP 400 "Tried to call function flood with invalid amount
    // of arguments" and broke the whole report.
    const query = buildWorkReportQuery(['laptop'], '[]', []);
    expect(query).toContain('events_0 = flood(window_raw_0);');
    expect(query).toContain('not_afk_0 = flood(afk_raw_0);');
    // Must NOT contain flood() with two arguments
    expect(query).not.toMatch(/flood\([^)]+,[^)]+\)/);
  });

  test('query caps events before categorization and reports raw source counts', () => {
    const query = buildWorkReportQuery(['laptop'], '[]', []);
    expect(query).toContain(
      `query_bucket("aw-watcher-window_laptop", ${WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD + 1})`
    );
    expect(query).toContain('event_count(window_raw_0)');
    expect(query).toContain(`limit_events(events, ${WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD})`);
    expect(query.indexOf('limit_events(events,')).toBeLessThan(query.indexOf('categorize(events,'));
  });

  test('buildWorkReportQuery produces a snapshot-stable query for multiple hosts', () => {
    const query = buildWorkReportQuery(['laptop', 'desktop'], '[]', [['Work']]);
    expect(query).toMatchSnapshot();
  });

  test('getSupportedWorkReportHosts preserves selected host order', () => {
    const moreBuckets = [
      ...buckets,
      {
        id: 'aw-watcher-window_desktop',
        hostname: 'desktop',
        device_id: 'desktop',
        type: 'currentwindow',
        data: {},
      },
      {
        id: 'aw-watcher-afk_desktop',
        hostname: 'desktop',
        device_id: 'desktop',
        type: 'afkstatus',
        data: {},
      },
    ];

    expect(getSupportedWorkReportHosts(['desktop', 'phone', 'laptop'], moreBuckets as any)).toEqual(
      ['desktop', 'laptop']
    );
  });
});

describe('versioned Work Report calculation', () => {
  test('matches the published synthetic calculation vector', () => {
    const result = calculateDailyWorkReport(
      vector.input.periods,
      vector.input.results,
      vector.input.break_time_seconds,
      {
        hostIds: vector.input.host_ids,
        categoryPaths: vector.input.category_paths,
        dateRange: vector.input.date_range,
        startOfDay: vector.input.start_of_day,
      }
    );
    expect(result.daily.map(({ events: _events, ...day }) => day)).toEqual(vector.expected.daily);
    expect(result.manifest).toEqual(vector.expected.manifest);
  });

  test('rejects malformed event intervals even when gap bridging is disabled', () => {
    expect(() =>
      calculateDailyWorkReport(
        vector.input.periods.slice(0, 1),
        [{ duration: 0, events: [{ timestamp: 'not-a-time', duration: -1 }] }],
        0,
        {
          hostIds: [],
          categoryPaths: [],
          dateRange: 'custom',
          startOfDay: '04:00',
        }
      )
    ).toThrow('valid timestamps and non-negative durations');
  });
});

describe('daily-derived Work Report periods', () => {
  test('aggregates and compares only equal calendar windows from the shared vector', () => {
    const { aggregate_days, current, previous } = periodsVector.input;
    expect(aggregateDailyWorkReport(aggregate_days as any, 'week')).toEqual(
      periodsVector.expected.weekly
    );
    expect(aggregateDailyWorkReport(aggregate_days as any, 'month')).toEqual(
      periodsVector.expected.monthly
    );
    expect(compareWorkReportPeriods(current as any, previous as any)).toEqual(
      periodsVector.expected.comparison
    );
    const fields = summarizeWorkReportFields(current as any);
    expect(fields).toEqual(periodsVector.expected.fields);
    expect(JSON.stringify(fields)).not.toContain('Private title');
  });

  test('rejects unequal or overlapping period comparisons', () => {
    const { current, previous } = periodsVector.input;
    expect(compareWorkReportPeriods(current as any, previous.slice(1) as any)).toBeNull();
    expect(compareWorkReportPeriods(current as any, current as any)).toBeNull();
  });

  test('does not aggregate duplicate local dates twice', () => {
    const days = periodsVector.input.aggregate_days as any[];
    expect(() => aggregateDailyWorkReport([...days, days[0]], 'month')).toThrow(
      'unique, sequential local dates'
    );
  });

  test('reports only explicit minimized fields and does not infer away time', () => {
    const fields = summarizeWorkReportFields([
      {
        date: '2026-06-01',
        duration: 120,
        sessions: 2,
        avgSession: 60,
        events: [
          {
            duration: 100,
            data: {
              app: 'Editor',
              title: 'Private title',
              url: 'https://example.com/private?token=x',
            },
          },
          { duration: 20, data: { status: 'afk' } },
        ],
      },
    ]);
    expect(fields.app).toEqual([{ label: 'Editor', duration: 100, sessions: 1 }]);
    expect(fields.domain).toEqual([{ label: 'example.com', duration: 100, sessions: 1 }]);
    expect(fields.active_away).toBeNull();
    expect(JSON.stringify(fields)).not.toMatch(/Private title|private\?|token=x/);
  });

  test('builds equal week-to-date windows and skips unequal month-to-date comparisons', () => {
    const week = buildWorkReportWindows('thisWeek', '04:00', moment('2026-06-03T15:30:00'));
    expect(
      week.current.map(period => moment.parseZone(period.split('/')[0]).format('YYYY-MM-DD'))
    ).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(
      week.previous?.map(period => moment.parseZone(period.split('/')[0]).format('YYYY-MM-DD'))
    ).toEqual(['2026-05-25', '2026-05-26', '2026-05-27']);

    const month = buildWorkReportWindows('thisMonth', '04:00', moment('2026-03-31T15:30:00'));
    expect(month.current).toHaveLength(31);
    expect(month.previous).toBeNull();

    const last7 = buildWorkReportWindows('last7d', '04:00', moment('2026-06-03T15:30:00'));
    expect(last7.current).toHaveLength(7);
    expect(last7.previous).toHaveLength(7);
    expect(
      last7.previous?.map(period => moment.parseZone(period.split('/')[0]).format('YYYY-MM-DD'))
    ).toEqual([
      '2026-05-21',
      '2026-05-22',
      '2026-05-23',
      '2026-05-24',
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
    ]);

    const last30 = buildWorkReportWindows('last30d', '04:00', moment('2026-06-03T15:30:00'));
    expect(last30.current).toHaveLength(30);
    expect(last30.previous).toHaveLength(30);
    expect(moment.parseZone(last30.current[0].split('/')[0]).format('YYYY-MM-DD')).toBe(
      '2026-05-05'
    );
    expect(moment.parseZone(last30.previous?.[0].split('/')[0] || '').format('YYYY-MM-DD')).toBe(
      '2026-04-05'
    );

    const early = buildWorkReportWindows('last7d', '04:00', moment('2026-06-03T02:00:00'));
    expect(moment.parseZone(early.current[6].split('/')[0]).format('YYYY-MM-DD')).toBe(
      '2026-06-02'
    );
    expect(early.partial_periods).toEqual(['2026-06-02']);
    expect(() =>
      buildWorkReportWindows('last7d', '25:00', moment('2026-06-03T15:30:00'))
    ).toThrow();
  });

  test('preserves exact local period boundaries across DST changes', () => {
    const result = calculateDailyWorkReport(
      timezoneVector.input.periods,
      timezoneVector.input.results,
      0,
      {
        hostIds: [],
        categoryPaths: [],
        dateRange: 'custom',
        startOfDay: '04:00',
      }
    );
    expect(result.daily.map(day => day.date)).toEqual(timezoneVector.expected.dates);
    expect(
      timezoneVector.input.periods.map(period => {
        const [start, end] = period.split('/');
        return moment.parseZone(end).diff(moment.parseZone(start), 'hours', true);
      })
    ).toEqual(timezoneVector.expected.period_hours);
    expect(result.manifest.input_periods).toEqual(timezoneVector.input.periods);
  });

  test('builds local 23- and 25-hour periods across Berlin DST transitions', () => {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Berlin') return;
    const spring = buildWorkReportWindows('last7d', '04:00', moment('2026-03-30T12:00:00'));
    const springDay = spring.current.find(period => period.startsWith('2026-03-28T04:00:00'));
    expect(springDay).toBeDefined();
    const [springStart, springEnd] = (springDay as string).split('/');
    expect(moment.parseZone(springEnd).diff(moment.parseZone(springStart), 'hours', true)).toBe(23);

    const fall = buildWorkReportWindows('last7d', '04:00', moment('2026-10-26T12:00:00'));
    const fallDay = fall.current.find(period => period.startsWith('2026-10-24T04:00:00'));
    expect(fallDay).toBeDefined();
    const [fallStart, fallEnd] = (fallDay as string).split('/');
    expect(moment.parseZone(fallEnd).diff(moment.parseZone(fallStart), 'hours', true)).toBe(25);
  });

  test('reports available versus queried sources and leaves multi-device clock skew unknown', () => {
    expect(
      buildWorkReportSourceCoverage({
        availableSourceBuckets: [
          'aw-watcher-window_phone',
          'aw-watcher-afk_tablet',
          'aw-watcher-afk_laptop',
          'aw-watcher-window_laptop',
        ],
        queriedSourceBuckets: ['aw-watcher-window_laptop', 'aw-watcher-afk_laptop'],
        queriedPeriods: ['start/end', 'previous-start/previous-end'],
        partialPeriods: ['2026-06-03'],
        limitedPeriods: [],
        timezone: 'Europe/Berlin',
        deviceCount: 2,
      })
    ).toEqual(timezoneVector.expected.source_coverage);
  });
});

describe('disclosed Work Report metrics', () => {
  test('matches the fixed-threshold focus, context-switch, and meeting vector', () => {
    const { focus: focusDaily, context_switches, meetings } = insightVector.input;
    expect(calculateFocusBlocks(focusDaily as any)).toEqual(insightVector.expected.focus);
    expect(calculateContextSwitches(context_switches as any)).toEqual(
      insightVector.expected.context_switches
    );
    expect(calculateMeetingLoad(meetings.daily as any, meetings.category_paths)).toEqual(
      insightVector.expected.meetings
    );
  });

  test('abstains when app fields or a reviewed meeting category are unavailable', () => {
    const { insufficient_context, meetings } = insightVector.input;
    expect(calculateFocusBlocks([]).outcome).toBe('could_not_determine');
    expect(calculateContextSwitches(insufficient_context as any).outcome).toBe(
      'could_not_determine'
    );
    expect(calculateMeetingLoad(meetings.daily as any, []).outcome).toBe('could_not_determine');
  });
});

describe('reproducible Work Report exports', () => {
  test('omits raw event payloads by default and includes them only after opt-in', () => {
    const rawEvents = [
      {
        events: [
          { timestamp: '2026-06-01T09:00:00Z', duration: 60, data: { title: 'Private title' } },
        ],
      },
    ];
    const report = {
      parameters: { dateRange: 'last7d' },
      calculation_manifest: vector.expected.manifest,
      daily: [
        {
          date: '2026-06-01',
          duration: 60,
          sessions: 1,
          avgSession: 60,
          events: rawEvents[0].events,
        },
      ],
    };

    const normal = buildWorkReportJsonExport(report, rawEvents, false);
    expect(normal).not.toHaveProperty('rawEvents');
    expect(normal.daily[0]).not.toHaveProperty('events');
    expect(JSON.stringify(normal)).not.toContain('Private title');
    expect(buildWorkReportJsonExport(report, rawEvents, true).rawEvents).toEqual(rawEvents);
  });

  test('CSV includes a machine-readable manifest companion row without event payloads', () => {
    const csv = buildWorkReportCsv(
      [
        {
          date: '2026-06-01',
          duration: 60,
          sessions: 1,
          avgSession: 60,
          events: [{ data: { title: 'Private title' } }],
        },
      ],
      { totalDuration: 60, totalSessions: 1, avgSessionLength: 60 },
      {
        calculation_manifest: vector.expected.manifest,
        source_coverage: { source_health: 'unknown' },
      }
    );
    expect(csv).toContain('# PeakActivity manifest,');
    expect(csv).toContain('work-time-report');
    expect(csv).not.toContain('Private title');
  });
});

describe('Work Report limits and cancellation', () => {
  test('marks only periods that exceeded a source or report row cap', () => {
    const periods = ['p1', 'p2', 'p3', 'p4'];
    expect(
      getLimitedWorkReportPeriods(
        [
          { report_event_count: WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD, source_event_counts: [] },
          {
            report_event_count: WORK_REPORT_MAX_EVENTS_PER_REPORT_PERIOD + 1,
            source_event_counts: [],
          },
          {
            report_event_count: 1,
            source_event_counts: [WORK_REPORT_MAX_EVENTS_PER_SOURCE_PERIOD + 1],
          },
          {},
        ],
        periods
      )
    ).toEqual(['p2', 'p3']);
  });

  test('recognizes Axios cancellation without treating other failures as cancellation', () => {
    expect(isWorkReportCancelled({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isWorkReportCancelled({ name: 'CanceledError' })).toBe(true);
    expect(isWorkReportCancelled({ code: 'ETIMEDOUT' })).toBe(false);
  });

  test('passes a per-report abort signal through to the local query request', async () => {
    const controller = new AbortController();
    const post = jest.fn(
      (_path, _body, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject({ code: 'ERR_CANCELED', name: 'CanceledError' }),
            { once: true }
          );
        })
    );
    const queryResult = queryWorkReport(
      { req: { post } } as any,
      'RETURN = [];',
      ['start/end'],
      controller.signal
    )
      .then(() => false)
      .catch(isWorkReportCancelled);

    controller.abort();

    await expect(queryResult).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith(
      '/0/query/',
      { query: ['RETURN = [];'], timeperiods: ['start/end'] },
      { signal: controller.signal }
    );
  });
});
