<template>
<section class="advanced-reports" aria-labelledby="advanced-report-title">
  <h4 id="advanced-report-title">Advanced reports</h4>
  <p>Reuse templates and rule packs. Calculations run locally; downloads use the completed snapshot.</p>
  <p v-if="!vault.isReady || vault.busy" role="status">Unlock the encrypted vault to use reports.</p>
  <template v-else>
    <p v-if="!paidAvailable" class="text-muted">An active Local Pro or Pro plan is required to create, import or run advanced reports. Existing metadata and downloads remain available.</p>
    <div v-if="errorMessage" class="alert alert-warning" role="alert">{{ errorMessage }}</div>
    <div class="mb-3 d-flex flex-wrap report-actions">
      <button type="button" class="btn btn-outline-secondary" data-library-reload :disabled="store.busy" @click="reload">Reload library</button>
      <button type="button" class="btn btn-outline-secondary" data-library-export :disabled="store.busy" @click="exportLibrary">Export library</button>
      <label class="btn btn-outline-secondary mb-0">Import library<input class="d-block" type="file" accept="application/json,.json" :disabled="!paidAvailable || store.busy" @change="importFile" /></label>
    </div>
    <div v-if="store.preview" class="border rounded p-3 mb-3" aria-label="Review library import">
      <h5>Review import</h5><p>New identifiers keep your existing library intact. Imported rule sets remain inactive.</p>
      <ul><li v-for="(mapping,i) in store.preview.mappings" :key="i">{{ mapping.kind }}: {{ mapping.from_id }} → {{ mapping.to_id }}</li></ul>
      <p>{{ store.preview.proposed_library.templates.length }} templates; {{ store.preview.proposed_library.rule_packs.length }} rule packs after import.</p>
      <button type="button" class="btn btn-primary" :disabled="!paidAvailable || store.busy" @click="acceptImport">Accept reviewed import</button>
    </div>
    <div class="row">
      <div class="col-lg-7">
        <label for="report-template">Report template</label>
        <select id="report-template" class="form-control mb-3" :value="selectedTemplateId" @change="setTemplate($event.target.value)"><option value="">Choose a template</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select>
        <div class="row">
          <label class="col-sm-6">First local date<input class="form-control" type="date" :value="startDate" @input="setDate('startDate',$event.target.value)" /></label>
          <label class="col-sm-6">Last local date<input class="form-control" type="date" :value="endDate" @input="setDate('endDate',$event.target.value)" /></label>
        </div>
        <label class="d-block"><input type="checkbox" :checked="comparePrevious" @change="setComparison($event.target.checked)" /> Compare the preceding equal-length period</label>
        <p class="small text-muted">Up to 186 current days, or 93 current plus 93 comparison days. Local day begins at {{ startOfDay }}. Device priority: {{ hostIds.join(' → ') || 'Select a host above' }}.</p>
        <div class="report-actions mb-3">
          <button type="button" class="btn btn-primary" data-report-run :disabled="!paidAvailable || !selectedTemplateId || store.busy || running" @click="runReport">Run report</button>
          <button v-if="running" type="button" class="btn btn-outline-danger" :disabled="store.cancelRequested" @click="store.cancel()">{{ store.cancelRequested ? 'Cancellation requested' : 'Cancel calculation' }}</button>
          <button v-if="running && store.errorReason" type="button" class="btn btn-outline-secondary" data-report-retry @click="store.read()">Retry status</button>
        </div>
        <p role="status" aria-live="polite">{{ statusMessage }}</p>
      </div>
      <div class="col-lg-5">
        <details><summary>Manage templates and rule packs</summary>
          <div v-for="template in templates" :key="template.id" class="d-flex align-items-center justify-content-between my-2"><span>{{ template.name }} · v{{ template.content_version }}</span><span><button type="button" class="btn btn-sm btn-outline-secondary" :disabled="!paidAvailable" @click="editTemplate(template)">Edit</button> <button type="button" class="btn btn-sm btn-outline-danger" data-template-remove :disabled="store.busy" @click="reviewRemoval('template',template.id)">Delete</button></span></div>
          <div v-for="pack in packs" :key="pack.id" class="d-flex align-items-center justify-content-between my-2"><span>{{ pack.name }} · v{{ pack.content_version }}</span><span><button type="button" class="btn btn-sm btn-outline-secondary" :disabled="!paidAvailable" @click="editPack(pack)">Edit</button> <button type="button" class="btn btn-sm btn-outline-danger" :disabled="store.busy" @click="reviewRemoval('rule-pack',pack.id)">Delete</button></span></div>
          <button type="button" class="btn btn-sm btn-outline-primary" :disabled="!paidAvailable" @click="editTemplate(null)">New template</button> <button type="button" class="btn btn-sm btn-outline-primary" :disabled="!paidAvailable" @click="editPack(null)">New rule pack</button>
        </details>
      </div>
    </div>
    <form v-if="editor" class="border rounded p-3 mb-3" @input="draftChanged" @submit.prevent="saveEditor">
      <h5>{{ editor==='template'?'Template':'Rule pack' }}</h5>
      <label class="d-block">Identifier<input class="form-control" v-model="draftId" :disabled="!!editingId" required maxlength="64" pattern="[a-z0-9-]+" /></label>
      <label class="d-block">Name<input class="form-control" v-model="draftName" required /></label>
      <template v-if="editor==='template'">
        <label class="d-block">Rule pack<select class="form-control" v-model="draftPackId"><option value="">Current active category rules</option><option v-for="pack in packs" :key="pack.id" :value="pack.id">{{ pack.name }}</option></select></label>
        <label class="d-block">Categories (empty selects all)<select class="form-control" v-model="draftPaths" multiple><option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.text }}</option></select></label>
        <label class="d-block">Bridge gaps up to seconds<input class="form-control" v-model.number="draftBreak" type="number" min="0" max="3600" /></label>
        <fieldset><legend class="h6">Sections, in display and print order</legend>
          <label v-for="section in sectionOptions" :key="section" class="mr-3"><input type="checkbox" :checked="draftSections.includes(section)" @change="toggleSection(section,$event.target.checked)" /> {{ sectionLabel(section) }}</label>
          <ol><li v-for="(section,index) in draftSections" :key="section">{{ sectionLabel(section) }} <button type="button" class="btn btn-sm btn-link" :disabled="index===0" @click="move(draftSections,index,-1)">Move up</button><button type="button" class="btn btn-sm btn-link" :disabled="index===draftSections.length-1" @click="move(draftSections,index,1)">Move down</button></li></ol>
        </fieldset>
      </template>
      <template v-else>
        <label class="d-block">Category sets<select class="form-control" v-model="draftSets" multiple><option v-for="set in categories.category_sets" :key="set.id" :value="set.id">{{ set.id }}</option></select></label>
        <ol><li v-for="(id,index) in draftSets" :key="id">{{ id }} <button type="button" class="btn btn-sm btn-link" :disabled="index===0" @click="move(draftSets,index,-1)">Move up</button><button type="button" class="btn btn-sm btn-link" :disabled="index===draftSets.length-1" @click="move(draftSets,index,1)">Move down</button></li></ol>
        <div v-if="dependentTemplates.length"><p>Updating this pack also requires reviewed version changes in: {{ dependentTemplates.map(t=>t.name).join(', ') }}.</p><label><input type="checkbox" v-model="repairPins" /> Update these linked templates to the reviewed pack version</label></div>
      </template>
      <p v-if="formError" class="text-danger" role="alert">{{ formError }}</p>
      <button type="submit" class="btn btn-primary" :disabled="!paidAvailable || store.busy">Save reviewed changes</button> <button type="button" class="btn btn-outline-secondary" @click="closeEditor">Close editor</button>
    </form>
    <div v-if="removal" class="border rounded p-3 mb-3" role="group" aria-label="Review deletion"><p>Delete {{ removal.id }}{{ removal.dependents.length ? ' and linked templates: '+removal.dependents.join(', ') : '' }}?</p><button type="button" class="btn btn-outline-danger" @click="confirmRemoval">Confirm deletion</button> <button type="button" class="btn btn-outline-secondary" @click="removal=null">Keep records</button></div>
    <article v-if="store.lastCompleted" aria-label="Completed native report">
      <h5>Completed report</h5><p>Work time {{ duration(store.lastCompleted.summary.totalDuration) }} · {{ store.lastCompleted.summary.totalSessions }} observed sessions. Capture health is unknown.</p>
      <div class="report-actions"><button type="button" class="btn btn-outline-secondary" data-report-csv @click="exportCSV">Export CSV</button><button type="button" class="btn btn-outline-secondary" data-report-json @click="exportJSON">Export JSON</button><button type="button" class="btn btn-outline-secondary" data-report-print :disabled="printing" @click="printReport">Print / save as PDF</button></div>
      <label class="d-block mt-2"><input type="checkbox" v-model="includeRaw" /> Include captured raw event fields in JSON</label>
      <p v-if="store.rawUnavailable" role="status">This report's raw snapshot is unavailable. Uncheck raw events to export its retained totals.</p>
      <p v-if="printing" role="status">System print dialog requested. Choose Print or Save as PDF there, or cancel.</p>
      <section v-for="section in store.lastCompleted.advanced_report_manifest.template.sections" :key="section" class="my-3"><h6>{{ sectionLabel(section) }}</h6><p v-if="sectionReason(section)">{{ sectionReason(section) }}</p><div v-else class="table-responsive"><table class="table table-sm"><thead><tr><th v-for="column in sectionTable(section).columns" :key="column" scope="col">{{ column }}</th></tr></thead><tbody><tr v-for="(row,i) in sectionTable(section).rows" :key="i"><td v-for="(cell,j) in row" :key="j">{{ cell }}</td></tr></tbody></table></div></section>
      <details><summary>Calculation details and source coverage</summary><pre class="report-manifest">{{ frozenJson }}</pre></details>
    </article>
  </template>
</section>
</template>
<script lang="ts">
import moment from 'moment';
import _ from 'lodash';
import { useReportStore } from '~/stores/reports';
import { useVaultStore } from '~/stores/vault';
import { useCategoryStore } from '~/stores/categories';
import experience from '~/generated/product-experience.json';
import { capability } from '~/product/experience';
import { loadNativeEntitlementStatus,hasFeatureEntitlement } from '~/util/entitlement';
import { buildManagedReportWindows,buildWorkReportCsv,buildWorkReportJsonExport } from '~/util/workReport';
import { REPORT_SECTIONS,parsePortableReportPack,parseReportResponse,reportCategoryFingerprint,reportUtf8Bytes } from '~/util/reportContracts';
import { prepareWorkReportPrint } from '~/util/workReportPrint';
const labels={daily:'Daily breakdown',weekly:'Weekly totals',monthly:'Monthly totals',comparison:'Previous period comparison','category-summary':'Categories','project-summary':'Projects','app-summary':'Applications','domain-summary':'Domains','active-away':'Active and away','focus-blocks':'Focus blocks','context-switches':'Context switches','meeting-load':'Meeting load'};
export default {
  name:'AdvancedReportPanel',props:{hostIds:{type:Array,required:true},startOfDay:{type:String,required:true}},
  data(){return {store:useReportStore(),vault:useVaultStore(),categories:useCategoryStore(),entitlement:null,selectedTemplateId:'',startDate:moment().subtract(6,'days').format('YYYY-MM-DD'),endDate:moment().format('YYYY-MM-DD'),comparePrevious:false,includeRaw:false,editor:'',editingId:'',draftId:'',draftName:'',draftPackId:'',draftPaths:[],draftBreak:0,draftSections:['daily'],draftSets:[],repairPins:false,formError:'',removal:null,printing:false,printJob:null,revision:0,sectionOptions:REPORT_SECTIONS};},
  computed:{
    templates(){return this.store.library?.templates||[];},packs(){return this.store.library?.rule_packs||[];},
    paidAvailable(){return hasFeatureEntitlement(capability('advanced-reports',experience)?.status,this.entitlement,'advanced-reports');},
    running(){return this.store.phase==='queued'||this.store.phase==='running';},
    dependentTemplates(){return this.editingId?this.templates.filter(t=>t.rule_pack?.id===this.editingId):[];},
    categoryOptions(){return this.categories.allCategoriesSelect.map(option=>({value:JSON.stringify(option.value),text:option.text}));},
    frozenJson(){return JSON.stringify(buildWorkReportJsonExport(this.store.lastCompleted,[],false),null,2);},
    errorMessage(){const reason=this.store.errorReason;return this.formError||({
      'entitlement-unavailable':'An active Local Pro or Pro plan is required for this operation.',
      'category-draft':'Save or discard your category edits before importing or reloading rules. Imported changes already saved by the app remain in the vault.',
      'stale-configuration':'The library or category rules changed. Reload and review your choices.',
      'raw-unavailable':'The retained raw snapshot is unavailable. Export without raw events.',
      'row-limit':'This report reached its event limit. Choose fewer dates or devices.',
      'byte-limit':'This report reached its data limit. Choose fewer dates or devices.',
      'value-limit':'This report reached its data limit. Choose fewer dates or devices.',
      'fuel-limit':'This report reached its work limit. Choose fewer dates or devices.',
      deadline:'The calculation timed out. Choose fewer dates or devices.',cancelled:'Calculation cancelled.',
      'invalid-response':'The app returned an invalid report response. Reload to try again.',
      'data-integrity':'Report data could not be validated. Review the library and category settings.',
      'source-unavailable':'Report status is unavailable. Unlock the vault or wait for the current calculation to finish.',
      'internal-error':'The calculation could not finish. Reload to try again.',
    }[reason]||'');},
    statusMessage(){if(this.store.cancelRequested)return 'Cancellation requested; waiting for the native calculation to stop.';if(this.store.phase==='queued')return 'Queued for local calculation.';if(this.store.phase==='running')return 'Calculating locally.';if(this.store.phase==='complete')return 'Completed snapshot ready.';return '';},
  },
  async mounted(){await this.reload();},
  beforeDestroy(){this.revision++;this.clearPrint();this.store.dispose();this.resetEditor();},
  watch:{'vault.isReady'(ready){if(!ready)this.clearPrivate();},'vault.busy'(busy){if(busy)this.clearPrivate();},hostIds:{handler(){this.changed();},deep:true},startOfDay(){this.changed();}},
  methods:{
    changed(){this.revision++;this.store.selectionChanged();},setDate(key,value){this.changed();this[key]=value;},setTemplate(value){this.changed();this.selectedTemplateId=value;},setComparison(value){this.changed();this.comparePrevious=value;},
    async reload(){const revision=++this.revision;const entitlement=await loadNativeEntitlementStatus();if(revision!==this.revision||!this.vault.isReady||this.vault.busy)return;this.entitlement=entitlement;await this.store.load();if(revision===this.revision&&!this.selectedTemplateId)this.selectedTemplateId=this.templates[0]?.id||'';},
    async runReport(){if(!this.paidAvailable||this.running)return;this.formError='';try{const windows=buildManagedReportWindows(this.startDate,this.endDate,this.comparePrevious,this.startOfDay);await this.store.start({schema_version:1,template_id:this.selectedTemplateId,expected_library_revision:this.store.library.revision,ordered_host_ids:[...this.hostIds],current_periods:windows.current.map(interval=>({local_date:interval.slice(0,10),interval})),previous_periods:windows.previous?.map(interval=>({local_date:interval.slice(0,10),interval}))||null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'local',timezone_resolution:'client-local-calendar-v1',day_start:this.startOfDay});}catch(_){this.formError='Choose valid local dates within 186 combined days and at least one supported device.';}},
    sectionLabel(value){return labels[value];},duration(value){const hours=Math.floor(value/3600),minutes=Math.floor((value%3600)/60);return `${hours}:${String(minutes).padStart(2,'0')}`;},
    sectionReason(section){const report=this.store.lastCompleted;if(section==='comparison'&&!report.comparison)return 'A comparable previous period is unavailable.';if(section==='active-away'&&!report.field_summaries.active_away)return 'Active and away time could not be determined.';return report.metrics[section.replace(/-/g,'_')]?.reason||'';},
    sectionTable(section){const r=this.store.lastCompleted;if(section==='daily')return{columns:['Date','Work time','Sessions'],rows:r.daily.map(d=>[d.date,this.duration(d.duration),d.sessions])};if(section==='weekly'||section==='monthly')return{columns:['Period','Work time','Sessions'],rows:r[section].map(d=>[d.period,this.duration(d.duration),d.sessions])};if(section==='comparison')return{columns:['Period','Work time'],rows:r.comparison?[['Current',this.duration(r.comparison.current.duration)],['Previous',this.duration(r.comparison.previous.duration)]]:[]};if(section==='category-summary')return{columns:['Category','Work time','Sessions'],rows:r.category_summary.categories.map(d=>[d.category_path.join(' > '),this.duration(d.duration),d.sessions])};if(section==='active-away')return{columns:['State','Work time'],rows:r.field_summaries.active_away?[['Active',this.duration(r.field_summaries.active_away.active_duration)],['Away',this.duration(r.field_summaries.active_away.away_duration)]]:[]};if(section.endsWith('-summary')){const field=section.split('-')[0];return{columns:['Label','Work time','Sessions'],rows:r.field_summaries[field].map(d=>[d.label,this.duration(d.duration),d.sessions])};}const metric=r.metrics[section.replace(/-/g,'_')];return{columns:section==='context-switches'?['Start','End','From','To']:['Start','End','Duration'],rows:metric.intervals.map(d=>section==='context-switches'?[d.start,d.end,d.from_app,d.to_app]:[d.start,d.end,this.duration(d.duration_seconds)])};},
    downloadFile(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);},
    exportCSV(){const report=this.store.lastCompleted;if(!report)return;const safe=buildWorkReportJsonExport(report,[],false);this.downloadFile(buildWorkReportCsv(report.daily,report.summary,safe),'advanced_work_report.csv','text/csv');},
    async exportJSON(){const report=this.store.lastCompleted;if(!report)return;if(this.includeRaw){await this.store.read({schema_version:1,run_id:this.store.completedRunId,include_raw_events:true});if(this.store.lastCompleted!==report||this.store.rawUnavailable||!this.store.rawEvents)return;}this.downloadFile(JSON.stringify(buildWorkReportJsonExport(report,this.store.rawEvents||[],this.includeRaw),null,2),'advanced_work_report.json','application/json');},
    printReport(){if(!this.store.lastCompleted||this.printing||!this.vault.isReady||this.vault.busy)return;try{this.printJob=prepareWorkReportPrint(this.store.lastCompleted,()=>{this.printing=false;this.printJob=null;});this.printing=true;this.printJob.print();}catch(_){this.clearPrint();this.formError='System printing is unavailable. Export CSV or JSON instead.';}},
    clearPrint(){const job=this.printJob;this.printJob=null;this.printing=false;job?.dispose();},
    clearPrivate(){this.revision++;this.entitlement=null;this.selectedTemplateId='';this.includeRaw=false;this.removal=null;this.clearPrint();this.resetEditor();this.store.clearSensitive();},
    resetEditor(){this.editor=this.editingId=this.draftId=this.draftName=this.draftPackId=this.formError='';this.draftPaths=[];this.draftSets=[];this.draftSections=['daily'];this.draftBreak=0;this.repairPins=false;},
    draftChanged(){this.changed();},closeEditor(){this.changed();this.resetEditor();},
    editTemplate(value){this.changed();this.resetEditor();this.editor='template';if(value){this.editingId=this.draftId=value.id;this.draftName=value.name;this.draftPackId=value.rule_pack?.id||'';this.draftPaths=value.category_paths.map(p=>JSON.stringify(p));this.draftSections=[...value.sections];this.draftBreak=value.break_time_seconds;}},
    editPack(value){this.changed();this.resetEditor();this.editor='rule-pack';if(value){this.editingId=this.draftId=value.id;this.draftName=value.name;this.draftSets=value.category_sets.map(s=>s.id);}},
    toggleSection(section,selected){this.draftSections=selected?[...this.draftSections,section]:this.draftSections.filter(s=>s!==section);},
    move(array,index,direction){this.changed();const next=[...array];[next[index],next[index+direction]]=[next[index+direction],next[index]];if(array===this.draftSections)this.draftSections=next;else this.draftSets=next;},
    async saveEditor(){if(!this.paidAvailable||!this.store.library)return;const revision=this.revision;const next=JSON.parse(JSON.stringify(this.store.library));this.formError='';
      try{if(this.editor==='template'){const pack=next.rule_packs.find(p=>p.id===this.draftPackId);const old=next.templates.find(t=>t.id===this.editingId);const value={id:this.draftId,name:this.draftName,content_version:old?.content_version||1,method_id:'work-time-report',method_version:1,sections:[...this.draftSections],category_paths:this.draftPaths.map(p=>JSON.parse(p)),break_time_seconds:this.draftBreak,rule_pack:pack?{id:pack.id,content_version:pack.content_version}:null};if(old){if(!_.isEqual(old,value))value.content_version++;next.templates=next.templates.map(t=>t.id===old.id?value:t);}else next.templates.push(value);
      }else{const refs=[];for(const id of this.draftSets){const set=this.categories.category_sets.find(s=>s.id===id);if(!set)throw new Error();refs.push({id,calculation_sha256:await reportCategoryFingerprint(set.categories)});if(revision!==this.revision)return;}const old=next.rule_packs.find(p=>p.id===this.editingId);const value={id:this.draftId,name:this.draftName,content_version:old?.content_version||1,category_sets:refs};if(old){if(!_.isEqual(old,value)){value.content_version++;if(this.dependentTemplates.length&&!this.repairPins){this.formError='Review linked template version updates before saving this pack.';return;}next.templates=next.templates.map(t=>t.rule_pack?.id===old.id?{...t,content_version:t.content_version+1,rule_pack:{id:old.id,content_version:value.content_version}}:t);}next.rule_packs=next.rule_packs.map(p=>p.id===old.id?value:p);}else next.rule_packs.push(value);}
        parseReportResponse(JSON.stringify(next),'library');await this.store.save({schema_version:1,expected_revision:next.revision,library:next});if(revision===this.revision&&!this.store.errorReason)this.resetEditor();
      }catch(_){this.formError='Review identifiers, names, category bindings, section order and linked versions before saving.';}
    },
    reviewRemoval(kind,id){this.removal={kind,id,dependents:kind==='rule-pack'?this.templates.filter(t=>t.rule_pack?.id===id).map(t=>t.name):[]};},async confirmRemoval(){const value=this.removal;this.removal=null;await this.store.remove(value.kind,value.id);},
    async exportLibrary(){const revision=this.revision;const value=await this.store.exportLibrary();if(value&&revision===this.revision&&this.vault.isReady&&!this.vault.busy)this.downloadFile(JSON.stringify(value.package,null,2),'report_library.json','application/json');},
    async importFile(event){const revision=++this.revision;this.store.selectionChanged();const file=event.target.files?.[0];if(!file)return;try{if(file.size>4194304)throw new Error();const raw=await file.text();if(revision!==this.revision||!this.vault.isReady||this.vault.busy)return;const value=parsePortableReportPack(raw);await this.store.previewImport(value);}catch(_){this.formError='Choose a valid report library JSON file no larger than 4MiB.';}finally{event.target.value='';}},
    async acceptImport(){if(!this.store.preview||!this.paidAvailable)return;await this.store.commitImport({schema_version:1,preview_id:this.store.preview.preview_id,accept:true});},
  },
};
</script>
<style scoped>
.report-actions{display:flex;gap:.5rem;flex-wrap:wrap}.report-manifest{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}label{font-weight:500}input[type=checkbox]{margin-right:.3rem}summary{cursor:pointer}
</style>
