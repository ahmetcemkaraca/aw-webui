import { buildWorkReportJsonExport } from './workReport';
import { parseReportResponse } from './reportContracts';

export interface WorkReportPrintJob { print(): void; dispose(): void; }
let activeDispose: (() => void) | null = null;
const UNAVAILABLE = 'The system print dialog is unavailable.';

const PRINT_STYLE = `
#work-report-print { display: none; }
@media print {
  @page { margin: 16mm; }
  body.work-report-print-mode {
    display: block !important; position: static !important; height: auto !important;
    min-height: 0 !important; overflow: visible !important; background: #fff !important; color: #111 !important;
  }
  body.work-report-print-mode > :not(#work-report-print) { display: none !important; }
  body.work-report-print-mode #work-report-print {
    display: block !important; position: static !important; width: auto !important;
    margin: 0; padding: 0; font: 11pt sans-serif; overflow: visible !important;
  }
  #work-report-print h1 { font-size: 18pt; }
  #work-report-print h2 { font-size: 13pt; break-after: avoid; }
  #work-report-print table { width: 100%; border-collapse: collapse; }
  #work-report-print th, #work-report-print td { padding: 4pt; border-bottom: 1px solid #bbb; text-align: left; }
  #work-report-print thead { display: table-header-group; }
  #work-report-print tr { break-inside: avoid; }
  #work-report-print pre {
    font: 8pt monospace; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
    overflow: visible; max-height: none; break-inside: auto;
  }
}
`;

export function prepareWorkReportPrint(report: Record<string, any>, onDispose?: () => void): WorkReportPrintJob {
  if (activeDispose || document.body.classList.contains('timesheet-print-mode')) {
    throw new Error('Another print dialog is already active.');
  }
  const json = JSON.stringify(buildWorkReportJsonExport(report, [], false), null, 2);
  const snapshot = JSON.parse(json);
  if (snapshot.advanced_report_manifest) {
    parseReportResponse(JSON.stringify({schema_version:1,run_id:'0'.repeat(32),state:'complete',queue_wait_ms:0,execution_ms:0,reason:null,result:snapshot}),'run-status');
  }
  const portal = document.createElement('article');
  portal.id = 'work-report-print';
  const style = document.createElement('style');
  style.setAttribute('data-work-report-print-style', '');
  style.textContent = PRINT_STYLE;
  const append = (parent: HTMLElement, tag: string, text: string): HTMLElement => {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.appendChild(element);
    return element;
  };
  const duration = (seconds: number) => `${Math.floor(seconds / 3600)}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}`;
  append(portal, 'h1', 'PeakActivity Work Time Report');
  append(portal, 'p', 'Completed calculation snapshot. Raw event payloads are excluded.');
  if (snapshot.source_coverage?.limited_periods?.length) {
    append(portal, 'p', 'Some queried periods reached an event-row limit; totals are incomplete. See the manifest for exact periods.');
  }
  const daily = () => {
    append(portal, 'h2', 'Daily breakdown');
    const table = append(portal, 'table', '');
    const head = append(append(table, 'thead', ''), 'tr', '');
    for (const label of ['Date', 'Work time', 'Sessions', 'Average session']) {
      append(head, 'th', label).setAttribute('scope', 'col');
    }
    const body = append(table, 'tbody', '');
    for (const day of [...snapshot.daily, {
      date: 'Total', duration: snapshot.summary.totalDuration, sessions: snapshot.summary.totalSessions,
      avgSession: snapshot.summary.avgSessionLength,
    }]) {
      const row = append(body, 'tr', '');
      append(row, 'th', String(day.date)).setAttribute('scope', 'row');
      append(row, 'td', duration(day.duration));
      append(row, 'td', String(day.sessions));
      append(row, 'td', duration(day.avgSession));
    }
  };
  const tableSection = (title:string,columns:string[],rows:unknown[][]) => {
    append(portal,'h2',title);
    const table=append(portal,'table','');const head=append(append(table,'thead',''),'tr','');
    columns.forEach(label=>append(head,'th',label).setAttribute('scope','col'));
    const body=append(table,'tbody','');
    rows.forEach(values=>{const row=append(body,'tr','');values.forEach(value=>append(row,'td',String(value??'')));});
  };
  if (!snapshot.advanced_report_manifest) daily();
  else for (const section of snapshot.advanced_report_manifest.template.sections) {
    if (section==='daily') daily();
    else if(section==='weekly'||section==='monthly') tableSection(section==='weekly'?'Weekly totals':'Monthly totals',['Period','Work time','Sessions'],snapshot[section].map(row=>[row.period,duration(row.duration),row.sessions]));
    else if(section==='comparison') {
      append(portal,'h2','Previous period comparison');
      if(!snapshot.comparison)append(portal,'p','A comparable previous period is unavailable.');
      else {append(portal,'p',`Current: ${duration(snapshot.comparison.current.duration)}. Previous: ${duration(snapshot.comparison.previous.duration)}.`);if(snapshot.comparison.coverage_note)append(portal,'p',snapshot.comparison.coverage_note);}
    } else if(section==='category-summary') tableSection('Categories',['Category','Work time','Sessions'],snapshot.category_summary.categories.map(row=>[row.category_path.join(' > '),duration(row.duration),row.sessions]));
    else if(['project-summary','app-summary','domain-summary'].includes(section)) {
      const field=section.split('-')[0];tableSection({project:'Projects',app:'Applications',domain:'Domains'}[field],['Label','Work time','Sessions'],snapshot.field_summaries[field].map(row=>[row.label,duration(row.duration),row.sessions]));
    } else if(section==='active-away') {
      append(portal,'h2','Active and away');const value=snapshot.field_summaries.active_away;
      append(portal,'p',value?`Active: ${duration(value.active_duration)}. Away: ${duration(value.away_duration)}.`:'Active and away time could not be determined.');
    } else {
      const key=section.replace(/-/g,'_');const metric=snapshot.metrics[key];
      const title={'focus-blocks':'Focus blocks','context-switches':'Context switches','meeting-load':'Meeting load'}[section];
      if(metric.outcome==='could_not_determine'){append(portal,'h2',title);append(portal,'p',metric.reason);}
      else if(section==='context-switches')tableSection(title,['Start','End','From','To','Gap seconds'],metric.intervals.map(row=>[row.start,row.end,row.from_app,row.to_app,row.gap_seconds]));
      else tableSection(title,['Start','End','Duration'],metric.intervals.map(row=>[row.start,row.end,duration(row.duration_seconds)]));
    }
  }
  append(portal, 'h2', 'Reproducible report manifest');
  append(portal, 'p', 'Exact calculation parameters, coverage, comparisons, aggregates, metrics and daily totals from this completed report:');
  append(portal, 'pre', json).setAttribute('aria-label', 'Exact Work Report JSON');
  let disposed = false;
  let started = false;
  let fallback: number | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (fallback !== undefined) window.clearTimeout(fallback);
    window.removeEventListener('afterprint', dispose);
    portal.remove(); style.remove();
    document.body.classList.remove('work-report-print-mode');
    activeDispose = null;
    onDispose?.();
  };
  document.head.appendChild(style);
  document.body.appendChild(portal);
  activeDispose = dispose;
  return {
    dispose,
    print() {
      if (disposed || started) return;
      if (typeof window.print !== 'function' || document.body.classList.contains('timesheet-print-mode')) {
        dispose(); throw new Error(UNAVAILABLE);
      }
      started = true;
      window.addEventListener('afterprint', dispose);
      document.body.classList.add('work-report-print-mode');
      fallback = window.setTimeout(dispose, 60_000);
      try { window.print(); }
      catch (_) { dispose(); throw new Error(UNAVAILABLE); }
    },
  };
}
