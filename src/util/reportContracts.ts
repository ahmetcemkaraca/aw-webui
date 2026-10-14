import { strictJson, utf8Bytes as reportUtf8Bytes } from './strictJson';
export { utf8Bytes as reportUtf8Bytes } from './strictJson';
import moment from 'moment';
import type { DailyWorkReportV1,WorkReportCalculationManifestV1,WorkReportSourceCoverageV1,WorkReportAggregateV1,WorkReportComparisonV1,WorkReportFieldSummaryV1,WorkReportFocusBlocksV1,WorkReportContextSwitchesV1,WorkReportMeetingLoadV1 } from './workReport';

export const REPORT_SECTIONS = ['daily','weekly','monthly','comparison','category-summary','project-summary','app-summary','domain-summary','active-away','focus-blocks','context-switches','meeting-load'] as const;
export type ReportSectionV1 = typeof REPORT_SECTIONS[number];
export const REPORT_REASONS = ['row-limit','byte-limit','value-limit','fuel-limit','deadline','cancelled','stale-configuration','source-unavailable','entitlement-unavailable','data-integrity','internal-error'] as const;
export type ReportReasonV1 = typeof REPORT_REASONS[number];
export interface ReportRuleV1 {type?:'regex'|'none'|null;regex?:string|null;ignore_case?:boolean|null}
export interface ReportCategoryV1 {id?:number|null;name:string[];rule:ReportRuleV1;data?:{color?:string|null;score?:number|string|null}|null}
export interface ReportRulePackV1 {id:string;name:string;content_version:number;category_sets:{id:string;calculation_sha256:string}[]}
export interface ReportTemplateV1 {id:string;name:string;content_version:number;method_id:'work-time-report';method_version:1;sections:ReportSectionV1[];category_paths:string[][];break_time_seconds:number;rule_pack:{id:string;content_version:number}|null}
export interface ReportLibraryV1 {schema_version:1;revision:number;templates:ReportTemplateV1[];rule_packs:ReportRulePackV1[]}
export interface PortableReportPackV1 {schema_version:1;templates:ReportTemplateV1[];rule_packs:ReportRulePackV1[];category_sets:{id:string;name:string;classes:ReportCategoryV1[]}[]}
export interface ReportResolvedPeriodV1 {local_date:string;interval:string}
export interface ReportRunRequestV1 {schema_version:1;template_id:string;expected_library_revision:number;ordered_host_ids:string[];current_periods:ReportResolvedPeriodV1[];previous_periods:ReportResolvedPeriodV1[]|null;timezone:string;timezone_resolution:'client-local-calendar-v1';day_start:string}
export const REPORT_LIMITS = {periods:186,hosts:8,source_rows:2000,merged_rows:4000,raw_rows:250000,bytes:33554432,values:1000000,fuel:5000000,execution_seconds:30,query_bytes:65536,ast_depth:64,event_json_bytes:1048576,regex_bytes:4096,regex_backtracks:100000,regex_cache_entries:256} as const;
export interface ReportAdvancedManifestV1 {schema_version:1;library_revision:number;resolved_request:ReportRunRequestV1;template:ReportTemplateV1;rule_pack:ReportRulePackV1|null;effective_rules:{set_id:string;category_path:string[];rule_index:number;rule:ReportRuleV1}[];sources:{host_id:string;window_bucket_id:string;afk_bucket_id:string}[];source_rows:{interval:string;bucket_id:string;rows:number}[];snapshot_time:string;overlap_precedence:'ordered-host-first-source-v1';label_tie_break:'utf16-code-unit-v1';limits:typeof REPORT_LIMITS}
export interface RawReportPeriodV1 {interval:string;buckets:{bucket_id:string;events:{id:number|null;timestamp:string;duration:number;data:Record<string,unknown>}[]}[]}
export interface ReportCompletedV1 {parameters:{host_ids:string[];category_paths:string[][];break_time_seconds:number;date_range:string;start_of_day:string};calculation_manifest:WorkReportCalculationManifestV1;source_coverage:WorkReportSourceCoverageV1;comparison:WorkReportComparisonV1|null;weekly:WorkReportAggregateV1[];monthly:WorkReportAggregateV1[];field_summaries:WorkReportFieldSummaryV1;metrics:{focus_blocks:WorkReportFocusBlocksV1|null;context_switches:WorkReportContextSwitchesV1|null;meeting_load:WorkReportMeetingLoadV1|null};summary:{totalDuration:number;totalSessions:number;avgSessionLength:number};daily:Omit<DailyWorkReportV1,'events'>[];advanced_report_manifest:ReportAdvancedManifestV1;category_summary:{method_id:string;method_version:number;formula:string;categories:{category_path:string[];duration:number;sessions:number}[]}|null;rawEvents?:RawReportPeriodV1[]}
export type ReportRunStateV1 = 'queued'|'running'|'complete'|'limited'|'cancelled'|'failed';
export interface ReportRunStatusV1 {schema_version:1;run_id:string;state:ReportRunStateV1;queue_wait_ms:number|null;execution_ms:number|null;reason:ReportReasonV1|null;result:ReportCompletedV1|null}
export interface ReportImportPreviewV1 {schema_version:1;preview_id:string;mappings:{kind:'category-set'|'rule-pack'|'template';from_id:string;to_id:string}[];proposed_library:ReportLibraryV1;expires_in_seconds:120}
export interface ReportResponsesV1 {
  library:ReportLibraryV1;
  'portable-export':{schema_version:1;package:PortableReportPackV1;unavailable_set_ids:string[]};
  'import-preview':ReportImportPreviewV1;
  'run-start':{schema_version:1;run_id:string;capability:string;state:'queued'};
  'run-status':ReportRunStatusV1;
  'run-cancel':{schema_version:1;run_id:string;requested:true};
  'run-release':{schema_version:1;run_id:string;released:boolean};
}
export type ReportResponseKindV1 = keyof ReportResponsesV1;
export type ReportResponseV1 = {[K in ReportResponseKindV1]:{kind:K;value:ReportResponsesV1[K]}}[ReportResponseKindV1];
const INVALID='Invalid advanced report response';
function assertReport(value:unknown):asserts value {if(!value)throw new Error(INVALID);}
type Check=(value:any,integer?:boolean)=>void;
const finite:Check=v=>assertReport(typeof v==='number'&&Number.isFinite(v));
const nonnegative:Check=v=>{finite(v);assertReport(v>=0);};
const uint:Check=(v,lex)=>assertReport(lex&&Number.isSafeInteger(v)&&v>=0);
const boolean:Check=v=>assertReport(typeof v==='boolean');
const literal=(value:any):Check=>(v,i)=>assertReport(v===value&&(typeof value!=='number'||i));
const choice=(values:readonly unknown[]):Check=>v=>assertReport(values.includes(v));
const nullable=(check:Check):Check=>(v,i)=>{if(v!==null)check(v,i);};
// eslint-disable-next-line no-control-regex -- Native labels reject C0 and C1 characters.
const text=(max:number,nonempty=false,controls=false):Check=>v=>assertReport(typeof v==='string'&&reportUtf8Bytes(v)<=max&&(!nonempty||v.length>0)&&(!controls||!/[\x00-\x1f\x7f-\x9f]/.test(v)));
const slug:Check=v=>{text(64,true)(v);assertReport(/^[a-z0-9-]+$/.test(v));};
const hex=(size:number):Check=>v=>assertReport(typeof v==='string'&&new RegExp(`^[a-f0-9]{${size}}$`).test(v));
const date:Check=v=>assertReport(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&moment.utc(v,'YYYY-MM-DD',true).isValid());
const time:Check=v=>assertReport(typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v));
const timestamp:Check=v=>assertReport(typeof v==='string'&&v.length<=128&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&moment.parseZone(v,moment.ISO_8601,true).isValid());
const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
const unique=(items:any[])=>assertReport(new Set(items.map(v=>JSON.stringify(v))).size===items.length);

export function parseReportResponse<K extends ReportResponseKindV1>(raw:string,kind:K):{kind:K;value:ReportResponsesV1[K]} {
  try {
    const {value,integers}=strictJson(raw,kind==='run-status'?33554432:kind==='portable-export'?4194304+262144:kind==='import-preview'?4194304:kind==='library'?1048576:16384);
    const record=(fields:Record<string,Check>,optional:Record<string,Check>={}):Check=>v=>{
      assertReport(v&&typeof v==='object'&&!Array.isArray(v));assertReport(Object.keys(fields).every(key=>Object.prototype.hasOwnProperty.call(v,key)));
      for(const key of Object.keys(v)){const check=Object.prototype.hasOwnProperty.call(fields,key)?fields[key]:Object.prototype.hasOwnProperty.call(optional,key)?optional[key]:undefined;assertReport(check);check(v[key],integers.get(v)?.has(key));}
    };
    const array=(check:Check,max:number,min=0):Check=>v=>{assertReport(Array.isArray(v)&&v.length>=min&&v.length<=max);v.forEach((item,i)=>check(item,integers.get(v)?.has(String(i))));};
    const labels=(count:number,bytes:number):Check=>array(text(bytes,true,true),count);
    const path:Check=array(text(128,true,true),8,1);const paths:Check=array(path,100);
    const positive:Check=(v,i)=>{uint(v,i);assertReport(v>0);};
    const bounded=(max:number):Check=>(v,i)=>{uint(v,i);assertReport(v<=max);};
    const rule:Check=v=>{record({}, {type:nullable(choice(['regex','none'])),regex:nullable(text(4096)),ignore_case:nullable(boolean)})(v);if(v.type==='regex')assertReport(typeof v.regex==='string');};
    const category:Check=record({name:path,rule}, {id:nullable(uint),data:nullable(record({}, {color:nullable(text(128,false,true)),score:nullable(v=>{
      if(typeof v==='number'){finite(v);return;}assertReport(typeof v==='string'&&reportUtf8Bytes(v)<=64&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())&&Number.isFinite(Number(v.trim())));
    })}))});
    const pin=record({id:slug,content_version:positive});
    const pack=record({id:slug,name:text(80,true,true),content_version:positive,category_sets:array(record({id:text(128,true,true),calculation_sha256:hex(64)}),16)});
    const template=record({id:slug,name:text(80,true,true),content_version:positive,method_id:literal('work-time-report'),method_version:literal(1),sections:array(choice(REPORT_SECTIONS),12,1),category_paths:paths,break_time_seconds:bounded(3600),rule_pack:nullable(pin)});
    const library:Check=v=>{record({schema_version:literal(1),revision:uint,templates:array(template,100),rule_packs:array(pack,100)})(v);
      unique(v.templates.map(t=>t.id));unique(v.rule_packs.map(p=>p.id));
      for(const p of v.rule_packs)unique(p.category_sets.map(s=>s.id));
      for(const t of v.templates){unique(t.sections);unique(t.category_paths);if(t.rule_pack)assertReport(v.rule_packs.some(p=>p.id===t.rule_pack.id&&p.content_version===t.rule_pack.content_version));}
    };
    // Validate portable library contents without adding synthetic numeric tokens/fields.
    const portableCheck:Check=v=>{record({schema_version:literal(1),templates:array(template,100),rule_packs:array(pack,100),category_sets:array(record({id:text(128,true,true),name:text(80,true,true),classes:array(category,1000)}),100)})(v);
      unique(v.templates.map(t=>t.id));unique(v.rule_packs.map(p=>p.id));unique(v.category_sets.map(s=>s.id));
      for(const p of v.rule_packs)unique(p.category_sets.map(s=>s.id));for(const t of v.templates){unique(t.sections);unique(t.category_paths);if(t.rule_pack)assertReport(v.rule_packs.some(p=>p.id===t.rule_pack.id&&p.content_version===t.rule_pack.content_version));}
    };
    const period:Check=v=>{record({local_date:date,interval:text(128,true)})(v);const parts=v.interval.split('/');assertReport(parts.length===2);parts.forEach(p=>timestamp(p));assertReport(Date.parse(parts[1])>Date.parse(parts[0])&&parts[0].slice(0,10)===v.local_date);};
    const periods:Check=v=>{array(period,186,1)(v);for(let i=1;i<v.length;i++)assertReport(v[i].local_date>v[i-1].local_date&&Date.parse(v[i].interval.split('/')[0])>=Date.parse(v[i-1].interval.split('/')[1]));};
    const request:Check=v=>{record({schema_version:literal(1),template_id:slug,expected_library_revision:uint,ordered_host_ids:labels(8,128),current_periods:periods,previous_periods:nullable(periods),timezone:text(128,true,true),timezone_resolution:literal('client-local-calendar-v1'),day_start:time})(v);
      assertReport(v.ordered_host_ids.length>0);unique(v.ordered_host_ids);if(v.previous_periods)assertReport(v.previous_periods.length===v.current_periods.length&&v.current_periods.length+v.previous_periods.length<=186&&Date.parse(v.previous_periods[v.previous_periods.length-1].interval.split('/')[1])<=Date.parse(v.current_periods[0].interval.split('/')[0]));};
    const method=(id:string)=>({method_id:literal(id),method_version:literal(1)});
    const summary=record({totalDuration:nonnegative,totalSessions:uint,avgSessionLength:nonnegative});
    const day=record({date,duration:nonnegative,sessions:bounded(4000),avgSession:nonnegative});
    const fields=record({...method('work-time-field-summary'),project:array(record({label:text(1048576,true),duration:nonnegative,sessions:uint}),250000),app:array(record({label:text(1048576,true),duration:nonnegative,sessions:uint}),250000),domain:array(record({label:text(1048576,true),duration:nonnegative,sessions:uint}),250000),active_away:nullable(record({active_duration:nonnegative,away_duration:nonnegative}))});
    const intervals=record({start:timestamp,end:timestamp,duration_seconds:nonnegative});
    const outcome=(v:any)=>{assertReport(v.outcome==='calculated'?v.reason===undefined:v.intervals.length===0&&typeof v.reason==='string'&&v.reason.length>0);};
    const focus:Check=v=>{record({...method('focus-blocks'),outcome:choice(['calculated','could_not_determine']),thresholds:record({minimum_duration_seconds:literal(1500),maximum_gap_seconds:literal(300)}),intervals:array(intervals,250000)},{reason:text(2048)})(v);outcome(v);};
    const context:Check=v=>{record({...method('context-switches'),outcome:choice(['calculated','could_not_determine']),thresholds:record({maximum_gap_seconds:literal(60)}),intervals:array(record({start:timestamp,end:timestamp,gap_seconds:nonnegative,from_app:text(1048576,true),to_app:text(1048576,true)}),250000)},{reason:text(2048)})(v);outcome(v);assertReport(v.intervals.every(r=>r.gap_seconds<=60));};
    const meeting:Check=v=>{record({...method('meeting-load'),outcome:choice(['calculated','could_not_determine']),thresholds:record({minimum_interval_seconds:literal(300)}),duration_seconds:nonnegative,intervals:array(intervals,250000)},{reason:text(2048)})(v);outcome(v);if(v.outcome==='could_not_determine')assertReport(v.duration_seconds===0);};
    const aggregate=record({...method('work-time-calendar-aggregate'),unit:choice(['week','month']),period:text(80,true),start_date:date,end_date:date,days:bounded(186),days_with_events:bounded(186),duration:nonnegative,sessions:uint});
    const periodSummary=record({start_date:date,end_date:date,periods:bounded(186),periods_with_events:bounded(186),observed_events:uint,duration:nonnegative});
    const comparison=record({...method('work-time-period-comparison'),current:periodSummary,previous:periodSummary,duration_change:finite,duration_change_percent:nullable(finite),coverage_note:nullable(text(2048))});
    const rawPeriod=record({interval:text(128,true),buckets:array(record({bucket_id:text(1024,true,true),events:array(record({id:nullable((v,i)=>assertReport(i&&Number.isSafeInteger(v))),timestamp,duration:nonnegative,data:v=>{assertReport(v&&typeof v==='object'&&!Array.isArray(v));assertReport(reportUtf8Bytes(JSON.stringify(v))<=1048576);}}),2000)}),16)});
    const completed:Check=v=>{
      const manifest=record({schema_version:literal(1),library_revision:uint,resolved_request:request,template,rule_pack:nullable(pack),effective_rules:array(record({set_id:text(128,true,true),category_path:path,rule_index:uint,rule}),128000),sources:array(record({host_id:text(128,true,true),window_bucket_id:text(1024,true,true),afk_bucket_id:text(1024,true,true)}),8),source_rows:array(record({interval:text(128,true),bucket_id:text(1024,true,true),rows:bounded(2000)}),2976),snapshot_time:timestamp,overlap_precedence:literal('ordered-host-first-source-v1'),label_tie_break:literal('utf16-code-unit-v1'),limits:record(Object.fromEntries(Object.entries(REPORT_LIMITS).map(([k,n])=>[k,literal(n)])))});
      record({parameters:record({host_ids:labels(8,128),category_paths:paths,break_time_seconds:bounded(3600),date_range:literal('custom'),start_of_day:time}),calculation_manifest:record({schema_version:literal(1),...method('work-time-report'),formula:text(2048,true),input_periods:labels(186,128),host_ids:labels(8,128),category_paths:paths,date_range:literal('custom'),start_of_day:time,break_time_seconds:bounded(3600),coverage:record({requested_periods:uint,periods_with_events:uint,events_seen:uint,source_health:literal('unknown'),limitation:text(2048,true)})}),source_coverage:record({...method('work-report-source-coverage'),available_source_buckets:labels(128,1024),queried_source_buckets:labels(128,1024),queried_periods:labels(186,128),partial_periods:array(date,186),limited_periods:array(text(128),0),source_row_limit:literal(2000),report_row_limit:literal(4000),timezone:text(128,true,true),source_health:literal('unknown'),clock_skew:record({status:choice(['unknown','not_applicable']),correction_bound_seconds:literal(0),limitation:text(2048,true)})}),comparison:nullable(comparison),weekly:array(aggregate,186),monthly:array(aggregate,186),field_summaries:fields,metrics:record({focus_blocks:nullable(focus),context_switches:nullable(context),meeting_load:nullable(meeting)}),summary,daily:array(day,186,1),advanced_report_manifest:manifest,category_summary:nullable(record({...method('work-time-category-summary'),formula:text(2048,true),categories:array(record({category_path:path,duration:nonnegative,sessions:uint}),250000)}))},{rawEvents:array(rawPeriod,186)})(v);
      const m=v.advanced_report_manifest,r=m.resolved_request,t=m.template,p=v.parameters,c=v.calculation_manifest;
      assertReport(m.library_revision===r.expected_library_revision&&t.id===r.template_id);
      assertReport(t.rule_pack?m.rule_pack&&t.rule_pack.id===m.rule_pack.id&&t.rule_pack.content_version===m.rule_pack.content_version:m.rule_pack===null);
      unique(t.sections);unique(t.category_paths);
      assertReport(same(p.host_ids,r.ordered_host_ids)&&same(p.category_paths,t.category_paths)&&p.break_time_seconds===t.break_time_seconds&&p.start_of_day===r.day_start);
      assertReport(same(c.host_ids,p.host_ids)&&same(c.category_paths,p.category_paths)&&c.break_time_seconds===p.break_time_seconds&&c.start_of_day===p.start_of_day&&same(c.input_periods,r.current_periods.map(p=>p.interval)));
      assertReport(v.daily.length===r.current_periods.length&&v.daily.every((d,i)=>d.date===r.current_periods[i].local_date&&d.avgSession===(d.sessions?d.duration/d.sessions:0)));
      const total=v.daily.reduce((sum,d)=>sum+d.duration,0),sessions=v.daily.reduce((sum,d)=>sum+d.sessions,0);
      assertReport(v.summary.totalDuration===total&&v.summary.totalSessions===sessions&&v.summary.avgSessionLength===(sessions?total/sessions:0)&&c.coverage.requested_periods===v.daily.length&&c.coverage.events_seen===sessions&&c.coverage.periods_with_events===v.daily.filter(d=>d.sessions>0).length);
      const selected=(s:string)=>t.sections.includes(s);
      assertReport((selected('weekly')||!v.weekly.length)&&(selected('monthly')||!v.monthly.length)&&(selected('comparison')||v.comparison===null));
      for(const [key,section] of [['project','project-summary'],['app','app-summary'],['domain','domain-summary']])assertReport(selected(section)||!v.field_summaries[key].length);
      assertReport(selected('active-away')||v.field_summaries.active_away===null);
      for(const [key,section] of [['focus_blocks','focus-blocks'],['context_switches','context-switches'],['meeting_load','meeting-load']])assertReport(selected(section)===(v.metrics[key]!==null));
      assertReport(selected('category-summary')===(v.category_summary!==null));
      const all=[...r.current_periods,...(r.previous_periods||[])];assertReport(same(v.source_coverage.queried_periods,all.map(p=>p.interval))&&v.source_coverage.timezone===r.timezone);
      assertReport(m.sources.length===r.ordered_host_ids.length&&m.sources.every((s,i)=>s.host_id===r.ordered_host_ids[i]&&s.window_bucket_id===`aw-watcher-window_${s.host_id}`&&s.afk_bucket_id===`aw-watcher-afk_${s.host_id}`));
      const ids=m.sources.flatMap(s=>[s.window_bucket_id,s.afk_bucket_id]);assertReport(same(v.source_coverage.queried_source_buckets,[...ids].sort())&&m.source_rows.length===all.length*ids.length&&m.source_rows.reduce((sum,s)=>sum+s.rows,0)<=250000);
      m.source_rows.forEach((s,i)=>assertReport(s.interval===all[Math.floor(i/ids.length)].interval&&s.bucket_id===ids[i%ids.length]));
      m.effective_rules.forEach((rule,i)=>assertReport(rule.rule_index===i));
      if(v.rawEvents){assertReport(v.rawEvents.length===all.length);v.rawEvents.forEach((period,i)=>{assertReport(period.interval===all[i].interval&&period.buckets.length===ids.length);period.buckets.forEach((bucket,j)=>assertReport(bucket.bucket_id===ids[j]&&bucket.events.length===m.source_rows[i*ids.length+j].rows));});}
    };
    const status:Check=v=>{record({schema_version:literal(1),run_id:hex(32),state:choice(['queued','running','complete','limited','cancelled','failed']),queue_wait_ms:nullable(uint),execution_ms:nullable(uint),reason:nullable(choice(REPORT_REASONS)),result:nullable(completed)})(v);
      if(v.state==='complete')assertReport(v.result!==null&&v.reason===null&&v.execution_ms!==null);
      else {assertReport(v.result===null);if(v.state==='queued'||v.state==='running')assertReport(v.reason===null);else if(v.state==='cancelled')assertReport(v.reason==='cancelled');else if(v.state==='limited')assertReport(REPORT_REASONS.slice(0,5).includes(v.reason));else assertReport(REPORT_REASONS.slice(6).includes(v.reason));assertReport(reportUtf8Bytes(raw)<=16384);}
    };
    const checks:Record<ReportResponseKindV1,Check>={library,'portable-export':record({schema_version:literal(1),package:portableCheck,unavailable_set_ids:labels(1600,128)}),'import-preview':record({schema_version:literal(1),preview_id:hex(32),mappings:array(record({kind:choice(['category-set','rule-pack','template']),from_id:text(128,true,true),to_id:text(128,true,true)}),300),proposed_library:library,expires_in_seconds:literal(120)}),'run-start':record({schema_version:literal(1),run_id:hex(32),capability:hex(64),state:literal('queued')}),'run-status':status,'run-cancel':record({schema_version:literal(1),run_id:hex(32),requested:literal(true)}),'run-release':record({schema_version:literal(1),run_id:hex(32),released:boolean})};
    assertReport(checks[kind]);checks[kind](value);return {kind,value};
  }catch(_){throw new Error(INVALID);}
}

export async function reportCategoryFingerprint(categories:ReportCategoryV1[]):Promise<string> {
  const canonical=categories.map(c=>({name:c.name,rule:c.rule.type==='regex'?{ignore_case:c.rule.ignore_case??false,regex:c.rule.regex,type:'regex'}:{type:'none'}}));
  const json=JSON.stringify(canonical);reportUtf8Bytes(json);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`PeakActivity:report-category-rules:v1\0${json}`));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function parsePortableReportPack(text:string):PortableReportPackV1 {
  if(reportUtf8Bytes(text)>4194304)throw new Error('Invalid advanced report response');
  return parseReportResponse(`{"schema_version":1,"package":${text},"unavailable_set_ids":[]}`,'portable-export').value.package;
}
