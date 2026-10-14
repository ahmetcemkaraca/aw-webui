import { prepareWorkReportPrint } from '~/util/workReportPrint';

function report() {
  return {
    parameters: { host_ids: ['Device <img src=x onerror=alert(1)>', 'Türkçe 日本語'], category_paths: [['Work']], break_time_seconds: 300, date_range: 'last7d', start_of_day: '04:00' },
    calculation_manifest: { method_id: 'work-time', method_version: 1, coverage: { limitation: 'No activity may mean missing capture.' } },
    source_coverage: { limited_periods: ['2026-10-13'], queried_periods: ['2026-10-13T04:00:00/2026-10-14T04:00:00'] },
    comparison: null, weekly: [{ duration: 3600 }], monthly: [{ duration: 3600 }],
    field_summaries: { app: [{ value: 'Editor', duration: 3600 }] }, metrics: { focus_blocks: { duration_seconds: 3600 } },
    summary: { totalDuration: 3600, totalSessions: 2, avgSessionLength: 1800 },
    daily: [{ date: '2026-10-13', duration: 3600, sessions: 2, avgSession: 1800, events: [{ data: { title: 'RAW-SECRET' } }] }],
    rawEvents: [{ data: { title: 'RAW-SECRET' } }],
  };
}

describe('frozen free Work Report printing', () => {
  let print;
  let job;
  beforeEach(() => { jest.useFakeTimers(); print = jest.spyOn(window, 'print').mockImplementation(() => {}); });
  afterEach(() => { job?.dispose(); job = null; window.dispatchEvent(new Event('afterprint')); document.body.classList.remove('timesheet-print-mode'); jest.restoreAllMocks(); jest.useRealTimers(); });

  test('prints a body-direct daily summary and complete frozen metadata without raw events', () => {
    const input = report();
    job = prepareWorkReportPrint(input);
    job.print();
    const portal = document.getElementById('work-report-print');
    expect(portal.parentElement).toBe(document.body);
    const metadata = JSON.parse(portal.querySelector('pre').textContent);
    expect(metadata.parameters.host_ids).toEqual(['Device <img src=x onerror=alert(1)>', 'Türkçe 日本語']);
    expect(metadata.calculation_manifest.coverage.limitation).toBe('No activity may mean missing capture.');
    expect(metadata.source_coverage.queried_periods).toEqual(input.source_coverage.queried_periods);
    expect(metadata.weekly).toEqual([{ duration: 3600 }]);
    expect(metadata.monthly).toEqual([{ duration: 3600 }]);
    expect(metadata.field_summaries.app).toEqual([{ value: 'Editor', duration: 3600 }]);
    expect(metadata.metrics.focus_blocks.duration_seconds).toBe(3600);
    expect(metadata.daily[0]).toEqual({ date: '2026-10-13', duration: 3600, sessions: 2, avgSession: 1800 });
    expect(metadata.rawEvents).toBeUndefined();
    expect(portal.textContent).not.toContain('RAW-SECRET');
    expect(portal.querySelectorAll('img,script')).toHaveLength(0);
    expect(portal.textContent).toContain('incomplete');
    const frozen = portal.textContent;
    input.parameters.host_ids[0] = 'changed'; input.daily[0].duration = 999;
    expect(portal.textContent).toBe(frozen);
    expect(print).toHaveBeenCalledTimes(1);
  });

  test('retains all daily rows and long Unicode metadata', () => {
    const input = report();
    input.parameters.host_ids.push('日'.repeat(10000));
    input.daily = Array.from({ length: 120 }, (_, index) => ({ date: `day-${index}`, duration: 60, sessions: 1, avgSession: 60 }));
    job = prepareWorkReportPrint(input);
    const portal = document.getElementById('work-report-print');
    expect(portal.querySelectorAll('tbody tr')).toHaveLength(121);
    expect(JSON.parse(portal.querySelector('pre').textContent).parameters.host_ids.at(-1)).toBe('日'.repeat(10000));
  });

  test('afterprint disposes private DOM, mode and listeners and permits the next job', () => {
    const disposed = jest.fn();
    job = prepareWorkReportPrint(report(), disposed); job.print();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('work-report-print')).toBeNull();
    expect(document.body.classList.contains('work-report-print-mode')).toBe(false);
    expect(document.querySelector('[data-work-report-print-style]')).toBeNull();
    expect(disposed).toHaveBeenCalledTimes(1);
    job.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    job = prepareWorkReportPrint(report()); job.print();
    expect(print).toHaveBeenCalledTimes(2);
  });

  test('duplicate jobs and reentrant print never open a second dialog', () => {
    job = prepareWorkReportPrint(report());
    print.mockImplementation(() => { job.print(); expect(() => prepareWorkReportPrint(report())).toThrow(); });
    job.print();
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('#work-report-print')).toHaveLength(1);
  });

  test('an active timesheet print is preserved and excludes a Work Report job', () => {
    document.body.classList.add('timesheet-print-mode');
    expect(() => prepareWorkReportPrint(report())).toThrow();
    expect(document.body.classList.contains('timesheet-print-mode')).toBe(true);
    expect(document.getElementById('work-report-print')).toBeNull();
    expect(print).not.toHaveBeenCalled();
  });

  test.each(['missing', 'throwing'])('%s system printing fails with no private portal left', kind => {
    job = prepareWorkReportPrint(report());
    if (kind === 'missing') window.print = undefined;
    else print.mockImplementation(() => { throw new Error('/private/raw/platform/error'); });
    expect(() => job.print()).toThrow('system print dialog');
    expect(document.getElementById('work-report-print')).toBeNull();
    expect(document.body.classList.contains('work-report-print-mode')).toBe(false);
  });

  test('fallback cleanup removes private data when a host never emits afterprint', () => {
    job = prepareWorkReportPrint(report()); job.print();
    jest.advanceTimersByTime(60_000);
    expect(document.getElementById('work-report-print')).toBeNull();
    expect(document.body.classList.contains('work-report-print-mode')).toBe(false);
  });
});

describe('native managed report printing',()=>{
  let job;
  afterEach(()=>{job?.dispose();job=null;});
  test('renders selected sections in reviewed template order and excludes raw data',()=>{
    const {reportCompleted}=require('./fixtures/reports');const input=reportCompleted();
    input.advanced_report_manifest.template.sections=['app-summary','daily','category-summary'];
    input.category_summary={method_id:'work-time-category-summary',method_version:1,formula:'categorized event durations grouped by category path; bridged gaps excluded',categories:[{category_path:['Work <img src=x>'],duration:60,sessions:1}]};
    input.rawEvents=[{data:{title:'PRIVATE-RAW-SECRET'}}];
    job=prepareWorkReportPrint(input);const portal=document.getElementById('work-report-print');
    expect([...portal.querySelectorAll('h2')].map(h=>h.textContent)).toEqual(['Applications','Daily breakdown','Categories','Reproducible report manifest']);
    expect(portal.textContent).toContain('Work <img src=x>');expect(portal.querySelector('img')).toBeNull();expect(portal.textContent).not.toContain('PRIVATE-RAW-SECRET');
    const original=portal.textContent;input.daily[0].duration=999;input.advanced_report_manifest.template.sections=['daily'];expect(portal.textContent).toBe(original);
  });
  test('rejects malformed managed provenance before creating a private portal',()=>{
    const {reportCompleted}=require('./fixtures/reports');const input=reportCompleted();input.advanced_report_manifest.limits.bytes=64*1024*1024;
    expect(()=>prepareWorkReportPrint(input)).toThrow();expect(document.getElementById('work-report-print')).toBeNull();
  });
});
