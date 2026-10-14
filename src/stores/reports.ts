import { defineStore } from 'pinia';
import { computed,onScopeDispose,ref } from 'vue';
import _ from 'lodash';
import { getClient } from '~/util/awclient';
import { useVaultStore } from '~/stores/vault';
import { useCategoryStore } from '~/stores/categories';
import { useSettingsStore } from '~/stores/settings';
import { cleanCategory,defaultCategories } from '~/util/classes';
import { parseReportResponse,REPORT_REASONS, type ReportReasonV1,type ReportResponseKindV1,type ReportResponsesV1,type ReportLibraryV1,type ReportCompletedV1,type ReportRunRequestV1,type ReportRunStatusV1,type ReportImportPreviewV1,type PortableReportPackV1,type RawReportPeriodV1 } from '~/util/reportContracts';

type Owner={run_id:string;capability:string};
type Failure=ReportReasonV1|'invalid-response'|'category-draft'|'raw-unavailable';
class ReportFailure extends Error {constructor(public reason:Failure){super(reason);}}
function failure(error:any):Failure {
  if(error instanceof ReportFailure)return error.reason;
  if(error instanceof Error&&error.message==='Invalid advanced report response')return 'invalid-response';
  try {const raw=error?.response?.data;if(typeof raw==='string'&&raw.length<=16384){const value=JSON.parse(raw);if(value?.schema_version===1&&REPORT_REASONS.includes(value.reason))return value.reason;}}catch(_){/* Malformed error bodies use the finite fallback. */}
  return 'source-unavailable';
}
function cleanSets(sets:any[]) {
  return sets.map(set=>({id:set.id,categories:set.categories.map(category=>{const result=cleanCategory(category);delete result.id;return result;})}));
}
function categoryState(category:any) {return {sets:cleanSets(category.category_sets),active:_.cloneDeep(category.active_set_ids)};}
function durableCategories(data:any) {
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ReportFailure('data-integrity');
  const sets=data.category_sets;
  if(Array.isArray(sets)&&sets.length){
    if(!sets.every(set=>typeof set?.id==='string'&&Array.isArray(set.categories)))throw new ReportFailure('data-integrity');
    return {sets:cleanSets(sets),active:Array.isArray(data.active_set_ids)&&data.active_set_ids.length?data.active_set_ids:[sets[0].id]};
  }
  if(sets!==undefined&&sets!==null&&!Array.isArray(sets))throw new ReportFailure('data-integrity');
  const classes=data.classes??defaultCategories;if(!Array.isArray(classes))throw new ReportFailure('data-integrity');
  return {sets:cleanSets([{id:'default',categories:classes}]),active:['default']};
}

export const useReportStore=defineStore('reports',()=>{
  const library=ref<ReportLibraryV1|null>(null),preview=ref<ReportImportPreviewV1|null>(null);
  const runId=ref<string|null>(null),capability=ref<string|null>(null),phase=ref<ReportRunStatusV1['state']|'idle'>('idle');
  const runStatus=ref<ReportRunStatusV1|null>(null),lastCompleted=ref<ReportCompletedV1|null>(null),rawEvents=ref<RawReportPeriodV1[]|null>(null);
  const errorReason=ref<Failure|null>(null),busy=ref(false),cancelRequested=ref(false),rawUnavailable=ref(false);
  const exported=ref<ReportResponsesV1['portable-export']|null>(null);
  const vault=useVaultStore(),categories=useCategoryStore(),settings=useSettingsStore();
  let generation=0,metadata=0,runSequence=0,rawSequence=0,disposed=false,reading=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const controllers=new Set<AbortController>();
  let completedOwner:Owner|null=null;
  const completedRunId=computed(()=>lastCompleted.value?completedOwner?.run_id??null:null);
  let pendingImport:{before:ReturnType<typeof categoryState>;library:ReportLibraryV1|null}|null=null;
  type Ticket={generation:number;kind:'metadata'|'run'|'raw';sequence:number;vault?:number};
  const current=(ticket:Ticket)=>!disposed&&ticket.generation===generation&&ticket.sequence===(ticket.kind==='metadata'?metadata:ticket.kind==='run'?runSequence:rawSequence);
  const ticket=(kind:Ticket['kind'],sequence:number):Ticket=>({generation,kind,sequence});
  function stopPolling(){if(timer!==undefined)clearTimeout(timer);timer=undefined;}
  function owner():Owner|null{return runId.value&&capability.value?{run_id:runId.value,capability:capability.value}:null;}
  function releaseQuietly(value:Owner|null) {
    if(!value)return;
    try {void getClient().req.post('/0/reports/run/release',{schema_version:1,run_id:value.run_id},{headers:{'X-PeakActivity-Report-Capability':value.capability},responseType:'text',transformResponse:[data=>data]}).catch(()=>undefined);}catch(_){/* Cleanup must remain synchronous when the client is unavailable. */}
  }
  function invalidateRequests(){generation++;metadata++;runSequence++;rawSequence++;stopPolling();for(const controller of controllers)controller.abort();controllers.clear();busy.value=false;}
  function clearSensitive(){
    const active=owner(),completed=completedOwner;invalidateRequests();
    library.value=preview.value=runStatus.value=lastCompleted.value=rawEvents.value=exported.value=null;
    runId.value=capability.value=null;completedOwner=null;pendingImport=null;phase.value='idle';errorReason.value=null;cancelRequested.value=rawUnavailable.value=false;
    releaseQuietly(active);if(completed?.run_id!==active?.run_id)releaseQuietly(completed);
  }
  function dispose(){clearSensitive();}
  onScopeDispose(()=>{disposed=true;clearSensitive();});
  function selectionChanged(){
    const active=owner();const running=phase.value==='queued'||phase.value==='running';invalidateRequests();
    preview.value=null;runId.value=capability.value=null;runStatus.value=null;phase.value='idle';cancelRequested.value=false;errorReason.value=null;
    if(running)releaseQuietly(active);
  }
  async function ready(t:Ticket):Promise<boolean>{
    if(!current(t))return false;
    const status=await vault.refresh();if(!current(t))return false;
    if(!status||status.state!=='ready'||vault.busy||(t.vault!==undefined&&t.vault!==status.generation)){
      clearSensitive();if(!disposed)errorReason.value='source-unavailable';return false;
    }
    t.vault=status.generation;return true;
  }
  async function request<K extends ReportResponseKindV1>(method:'get'|'post'|'put',path:string,body:unknown,kind:K,owned?:Owner):Promise<ReportResponsesV1[K]> {
    const controller=new AbortController();controllers.add(controller);
    const options={signal:controller.signal,responseType:'text' as const,transformResponse:[(data:any)=>data],...(owned?{headers:{'X-PeakActivity-Report-Capability':owned.capability}}:{})};
    try {const client=getClient();const response=method==='get'?await client.req.get(path,options):method==='put'?await client.req.put(path,body,options):await client.req.post(path,body,options);
      if(typeof response.data!=='string')throw new ReportFailure('invalid-response');return parseReportResponse(response.data,kind).value;
    }finally{controllers.delete(controller);}
  }
  async function noCategoryDraft(t:Ticket){
    if(categories.classes_unsaved_changes)throw new ReportFailure('category-draft');
    const saved=await getClient().get_settings();if(!current(t))return false;
    if(categories.classes_unsaved_changes||!_.isEqual(categoryState(categories),durableCategories(saved)))throw new ReportFailure('category-draft');return true;
  }
  async function load(){const t=ticket('metadata',++metadata);busy.value=true;errorReason.value=null;
    try {if(!await ready(t))return;
      if(pendingImport?.library){if(categories.classes_unsaved_changes||!_.isEqual(categoryState(categories),pendingImport.before))throw new ReportFailure('category-draft');
        await settings.load({save:false});if(!await ready(t))return;categories.load();pendingImport=null;}
      const value=await request('get','/0/reports/library',undefined,'library');if(await ready(t))library.value=value;
    }catch(error){if(current(t))errorReason.value=failure(error);}finally{if(current(t))busy.value=false;}
  }
  async function save(value:{schema_version:1;expected_revision:number;library:ReportLibraryV1}){
    const t=ticket('metadata',++metadata);busy.value=true;errorReason.value=null;
    try {if(!await ready(t))return;const response=await request('put','/0/reports/library',value,'library');if(await ready(t))library.value=response;
    }catch(error){if(current(t))errorReason.value=failure(error);}finally{if(current(t))busy.value=false;}
  }
  async function remove(kind:'template'|'rule-pack',id:string){
    if(!library.value)return;const next=JSON.parse(JSON.stringify(library.value)) as ReportLibraryV1;
    if(kind==='template')next.templates=next.templates.filter(t=>t.id!==id);
    else {next.rule_packs=next.rule_packs.filter(p=>p.id!==id);next.templates=next.templates.filter(t=>t.rule_pack?.id!==id);}
    await save({schema_version:1,expected_revision:next.revision,library:next});
  }
  async function exportLibrary(value={schema_version:1 as const,include_category_sets:true}){
    const t=ticket('metadata',++metadata);busy.value=true;errorReason.value=null;exported.value=null;
    try {if(!await ready(t))return;const response=await request('post','/0/reports/library/export',value,'portable-export');if(await ready(t)){exported.value=response;return response;}
    }catch(error){if(current(t))errorReason.value=failure(error);}finally{if(current(t))busy.value=false;}
  }
  async function previewImport(value:PortableReportPackV1){const t=ticket('metadata',++metadata);busy.value=true;errorReason.value=null;preview.value=null;
    try {if(!await ready(t)||!await noCategoryDraft(t))return;const before=categoryState(categories);
      const response=await request('post','/0/reports/import/preview',value,'import-preview');if(!await ready(t))return;
      if(categories.classes_unsaved_changes||!_.isEqual(before,categoryState(categories)))throw new ReportFailure('category-draft');preview.value=response;
    }catch(error){if(current(t))errorReason.value=failure(error);}finally{if(current(t))busy.value=false;}
  }
  async function commitImport(value:{schema_version:1;preview_id:string;accept:true}){
    if(!preview.value||preview.value.preview_id!==value.preview_id){errorReason.value='stale-configuration';return;}
    const t=ticket('metadata',++metadata);busy.value=true;errorReason.value=null;
    try {if(!await ready(t)||!await noCategoryDraft(t))return;
      const before=categoryState(categories);pendingImport={before,library:null};
      const response=await request('post','/0/reports/import/commit',value,'library');if(!current(t))return;pendingImport.library=response;
      if(!await ready(t))return;
      if(categories.classes_unsaved_changes||!_.isEqual(before,categoryState(categories)))throw new ReportFailure('category-draft');
      await settings.load({save:false});if(!await ready(t))return;
      if(categories.classes_unsaved_changes||!_.isEqual(before,categoryState(categories)))throw new ReportFailure('category-draft');
      categories.load();library.value=response;preview.value=null;pendingImport=null;
    }catch(error){if(current(t)){errorReason.value=failure(error);if(pendingImport&&!pendingImport.library)pendingImport=null;}}
    finally{if(current(t))busy.value=false;}
  }
  function schedule(){stopPolling();if(!disposed&&(phase.value==='queued'||phase.value==='running'))timer=setTimeout(()=>{timer=undefined;void read();},500);}
  async function start(value:ReportRunRequestV1){
    const previous=owner();if(phase.value==='queued'||phase.value==='running')releaseQuietly(previous);
    stopPolling();const t=ticket('run',++runSequence);runId.value=capability.value=null;phase.value='idle';cancelRequested.value=false;errorReason.value=null;
    let response:ReportResponsesV1['run-start']|null=null;
    try {if(!await ready(t))return;const frozen=JSON.parse(JSON.stringify(value));
      response=await request('post','/0/reports/run/start',frozen,'run-start');
      if(!await ready(t)){releaseQuietly(response);return;}
      runId.value=response.run_id;capability.value=response.capability;phase.value='queued';schedule();
    }catch(error){if(response)releaseQuietly(response);if(current(t))errorReason.value=failure(error);}
  }
  async function read(value?:{schema_version:1;run_id:string;include_raw_events:boolean}){
    if(value?.include_raw_events){await readRaw(value);return;}
    if(reading)return;const active=owner();if(!active)return;
    const t=ticket('run',runSequence);reading=true;let poll=true;
    try {if(!await ready(t))return;const response=await request('post','/0/reports/run/read',{schema_version:1,run_id:active.run_id,include_raw_events:false},'run-status',active);
      if(!await ready(t))return;if(response.run_id!==active.run_id)throw new ReportFailure('invalid-response');
      phase.value=response.state;runStatus.value=response;errorReason.value=response.reason;
      if(response.state==='complete'){lastCompleted.value=response.result;completedOwner=active;rawEvents.value=null;rawUnavailable.value=false;errorReason.value=null;}
      else if(response.reason)errorReason.value=response.reason;
      if(response.state!=='queued'&&response.state!=='running'){stopPolling();cancelRequested.value=false;}
    }catch(error){if(current(t)){errorReason.value=failure(error);stopPolling();poll=false;}}
    finally{reading=false;if(!disposed&&(poll||!current(t)))schedule();}
  }
  async function readRaw(value:{schema_version:1;run_id:string;include_raw_events:boolean}){
    const owned=completedOwner,completed=lastCompleted.value;if(!owned||!completed||value.run_id!==owned.run_id){rawUnavailable.value=true;errorReason.value='raw-unavailable';return;}
    const t=ticket('raw',++rawSequence);
    try {if(!await ready(t))return;const response=await request('post','/0/reports/run/read',value,'run-status',owned);if(!await ready(t)||lastCompleted.value!==completed)return;
      if(response.run_id!==owned.run_id||response.state!=='complete'||!response.result?.rawEvents)throw new ReportFailure('raw-unavailable');
      const {rawEvents:raw,...withoutRaw}=response.result;if(!_.isEqual(withoutRaw,completed))throw new ReportFailure('invalid-response');
      rawEvents.value=raw;rawUnavailable.value=false;
    }catch(error){if(current(t)){rawEvents.value=null;rawUnavailable.value=true;errorReason.value=failure(error)==='invalid-response'?'invalid-response':'raw-unavailable';}}
  }
  async function cancel(){const active=owner();if(!active)return;const t=ticket('run',runSequence);
    try {if(!await ready(t))return;const response=await request('post','/0/reports/run/cancel',{schema_version:1,run_id:active.run_id},'run-cancel',active);if(await ready(t)){if(response.run_id!==active.run_id)throw new ReportFailure('invalid-response');cancelRequested.value=response.requested;schedule();}}
    catch(error){if(current(t))errorReason.value=failure(error);}
  }
  async function release(){const active=owner();const running=phase.value==='queued'||phase.value==='running';selectionChanged();if(!running)releaseQuietly(active);if(active?.run_id===completedOwner?.run_id){rawEvents.value=null;rawUnavailable.value=true;}}
  return {library,preview,runId,completedRunId,capability,phase,runStatus,lastCompleted,rawEvents,errorReason,busy,cancelRequested,rawUnavailable,exported,load,save,remove,exportLibrary,previewImport,commitImport,start,read,cancel,release,selectionChanged,clearSensitive,dispose};
});
