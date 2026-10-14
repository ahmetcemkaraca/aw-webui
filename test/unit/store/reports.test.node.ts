import { parseReportResponse } from '~/util/reportContracts';
import { reportLibrary,reportStart,reportStatus } from '../fixtures/reports';

describe('strict native report contracts',()=>{
  test('accepts native library/start/completed wire records',()=>{
    for(const [kind,value] of [['library',reportLibrary()],['run-start',reportStart()],['run-status',reportStatus()]] as const) {
      expect(parseReportResponse(JSON.stringify(value),kind).value).toEqual(value);
    }
  });
  test.each([
    ['tuple','[]'],['duplicate schema','{"schema_version":1,"schema_version":1,"revision":0,"templates":[],"rule_packs":[]}'],
    ['decoded duplicate','{"schema_version":1,"revision":0,"templates":[],"rule_packs":[],"\\u0072evision":0}'],
    ['unknown key',JSON.stringify({...reportLibrary(),extra:true})],['prototype key',JSON.stringify({...reportLibrary(),constructor:3})],['wrong schema',JSON.stringify({...reportLibrary(),schema_version:2})],
    ['float integer token','{"schema_version":1.0,"revision":0,"templates":[],"rule_packs":[]}'],
    ['unsafe integer','{"schema_version":1,"revision":9007199254740993,"templates":[],"rule_packs":[]}'],
    ['nonfinite','{"schema_version":1,"revision":1e400,"templates":[],"rule_packs":[]}'],
    ['lone surrogate',JSON.stringify(reportLibrary()).replace('"Work"','"\\ud800"')],
    ['UTF8 name bound',JSON.stringify({...reportLibrary(),templates:[{...reportLibrary().templates[0],name:'é'.repeat(41)}]})],
  ])('rejects %s before publication',(_name,text)=>expect(()=>parseReportResponse(text,'library')).toThrow('Invalid advanced report response'));
  test('rejects inconsistent or ambiguous completed data',()=>{
    for(const mutate of [
      (v:any)=>v.result.daily[0].events=[],(v:any)=>v.result.summary.totalDuration=61,
      (v:any)=>v.result.advanced_report_manifest.limits.bytes=64*1024*1024,
      (v:any)=>v.result.advanced_report_manifest.sources[0].host_id='Other',
      (v:any)=>v.result.metrics.focus_blocks={method_id:'focus-blocks',method_version:1,outcome:'calculated',thresholds:{minimum_duration_seconds:1500,maximum_gap_seconds:300},intervals:[]},
      (v:any)=>v.result.source_coverage.limited_periods=['secret'],
    ]) {const value=reportStatus();mutate(value);expect(()=>parseReportResponse(JSON.stringify(value),'run-status')).toThrow();}
  });
  test('accepts finite failure without partial result and rejects misleading totals',()=>{
    expect(parseReportResponse(JSON.stringify(reportStatus('limited','byte-limit')),'run-status').value).toEqual(reportStatus('limited','byte-limit'));
    const value=reportStatus('cancelled','cancelled');value.result=reportStatus().result;
    expect(()=>parseReportResponse(JSON.stringify(value),'run-status')).toThrow();
  });
});

import { createPinia,setActivePinia } from 'pinia';
import { useReportStore } from '~/stores/reports';
import { reportCompleted,reportRequest } from '../fixtures/reports';
const mockReq={get:jest.fn(),post:jest.fn(),put:jest.fn()};
const mockClient={req:mockReq,get_settings:jest.fn()};
const mockVault={isReady:true,busy:false,status:{state:'ready',generation:1},refresh:jest.fn()};
const mockCategories:any={classes_unsaved_changes:false,category_sets:[{id:'default',categories:[]}],active_set_ids:['default'],load:jest.fn()};
const mockSettings={load:jest.fn()};
jest.mock('~/util/awclient',()=>({getClient:()=>mockClient}));
jest.mock('~/stores/vault',()=>({useVaultStore:()=>mockVault}));
jest.mock('~/stores/categories',()=>({useCategoryStore:()=>mockCategories}));
jest.mock('~/stores/settings',()=>({useSettingsStore:()=>mockSettings}));
const wire=(value:any)=>({data:JSON.stringify(value)});
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return{promise,resolve};};

describe('owned report store',()=>{
  let store:ReturnType<typeof useReportStore>;
  beforeEach(()=>{
    jest.useFakeTimers();setActivePinia(createPinia());jest.resetAllMocks();
    mockVault.isReady=true;mockVault.busy=false;mockVault.refresh.mockResolvedValue({state:'ready',generation:1});
    mockCategories.classes_unsaved_changes=false;mockCategories.category_sets=[{id:'default',categories:[]}];mockCategories.active_set_ids=['default'];
    mockClient.get_settings.mockResolvedValue({classes:[]});mockReq.get.mockResolvedValue(wire(reportLibrary()));mockReq.put.mockResolvedValue(wire(reportLibrary()));
    mockReq.post.mockImplementation((path:string)=>Promise.resolve(wire(path.endsWith('start')?reportStart():path.endsWith('cancel')?{schema_version:1,run_id:'a'.repeat(32),requested:true}:path.endsWith('release')?{schema_version:1,run_id:'a'.repeat(32),released:true}:reportStatus())));
    mockSettings.load.mockResolvedValue(undefined);store=useReportStore();
  });
  afterEach(()=>{store.$dispose();jest.useRealTimers();});
  test('loads raw text through the existing authenticated client',async()=>{
    await store.load();expect(store.library).toEqual(reportLibrary());expect(mockReq.get).toHaveBeenCalledWith('/0/reports/library',expect.objectContaining({responseType:'text',transformResponse:expect.any(Array)}));
  });
  test('a failed export clears the previous package and returns no downloadable result',async()=>{
    const exported={schema_version:1,package:{schema_version:1,templates:[],rule_packs:[],category_sets:[]},unavailable_set_ids:[]};
    mockReq.post.mockResolvedValueOnce(wire(exported));await store.exportLibrary();expect(store.exported).toEqual(exported);
    mockReq.post.mockRejectedValueOnce(new Error('Disconnected'));expect(await store.exportLibrary()).toBeUndefined();expect(store.exported).toBeNull();
  });
  test.each(['clearSensitive','dispose','$dispose'])('%s prevents a late library response from restoring private state',async action=>{
    const pending=deferred();mockReq.get.mockReturnValueOnce(pending.promise);const loading=store.load();await Promise.resolve();await Promise.resolve();(store as any)[action]();pending.resolve(wire(reportLibrary()));await loading;expect(store.library).toBeNull();expect(store.capability).toBeNull();
  });
  test('failed fresh vault status clears data despite a previously ready cached status',async()=>{
    await store.load();store.lastCompleted=reportCompleted() as any;mockVault.refresh.mockResolvedValueOnce(null);await store.load();expect(store.library).toBeNull();expect(store.lastCompleted).toBeNull();
  });
  test('cancel is an independent native request and remains requested until native ACK',async()=>{
    await store.start(reportRequest() as any);const pending=deferred();mockReq.post.mockReturnValueOnce(pending.promise);const reading=store.read();await Promise.resolve();await Promise.resolve();
    mockReq.post.mockResolvedValueOnce(wire({schema_version:1,run_id:'a'.repeat(32),requested:true}));await store.cancel();expect(store.cancelRequested).toBe(true);expect(store.phase).toBe('queued');
    expect(mockReq.post).toHaveBeenCalledWith('/0/reports/run/cancel',expect.objectContaining({run_id:'a'.repeat(32)}),expect.objectContaining({headers:{'X-PeakActivity-Report-Capability':'b'.repeat(64)}}));
    pending.resolve(wire(reportStatus('cancelled','cancelled')));await reading;expect(store.phase).toBe('cancelled');
  });
  test.each([['limited','byte-limit'],['cancelled','cancelled'],['failed','entitlement-unavailable']])('%s preserves the previous completed artifact',async(state,reason)=>{
    await store.start(reportRequest() as any);await store.read();expect([store.phase,store.errorReason]).toEqual(['complete',null]);expect(store.lastCompleted).not.toBeNull();const previous=JSON.parse(JSON.stringify(store.lastCompleted));
    await store.start(reportRequest() as any);mockReq.post.mockResolvedValueOnce(wire(reportStatus(state,reason)));await store.read();expect(store.lastCompleted).toEqual(previous);
  });
  test('selection change disposes a late start capability instead of publishing it',async()=>{
    const pending=deferred();mockReq.post.mockReturnValueOnce(pending.promise);const starting=store.start(reportRequest() as any);await Promise.resolve();await Promise.resolve();store.selectionChanged();pending.resolve(wire(reportStart()));await starting;
    expect(store.capability).toBeNull();expect(mockReq.post.mock.calls.some(call=>call[0]==='/0/reports/run/release')).toBe(true);
  });
  test('raw data is requested using the preserved artifact owner, never the next run',async()=>{
    await store.start(reportRequest() as any);await store.read();expect([store.phase,store.errorReason]).toEqual(['complete',null]);expect(store.lastCompleted).not.toBeNull();const previous=JSON.parse(JSON.stringify(store.lastCompleted));
    mockReq.post.mockResolvedValueOnce(wire({...reportStart(),run_id:'c'.repeat(32),capability:'d'.repeat(64)}));await store.start(reportRequest() as any);
    const raw=reportStatus();(raw.result as any).rawEvents=[{interval:reportRequest().current_periods[0].interval,buckets:[{bucket_id:'aw-watcher-window_Host',events:[{id:1,timestamp:'2026-01-01T12:00:00Z',duration:60,data:{app:'Editor'}}]},{bucket_id:'aw-watcher-afk_Host',events:[{id:2,timestamp:'2026-01-01T12:00:00Z',duration:60,data:{status:'not-afk'}}]}]}];
    mockReq.post.mockResolvedValueOnce(wire(raw));await store.read({schema_version:1,run_id:'a'.repeat(32),include_raw_events:true});
    expect(mockReq.post).toHaveBeenLastCalledWith('/0/reports/run/read',expect.objectContaining({run_id:'a'.repeat(32)}),expect.objectContaining({headers:{'X-PeakActivity-Report-Capability':'b'.repeat(64)}}));
    expect(store.lastCompleted).toEqual(previous);expect(store.rawEvents).toHaveLength(1);
  });
  test('a failed read stops polling while preserving owned cancellation',async()=>{
    await store.start(reportRequest() as any);mockReq.post.mockRejectedValueOnce({response:{data:'{"schema_version":1,"reason":"source-unavailable"}'}});await store.read();
    const count=mockReq.post.mock.calls.length;jest.advanceTimersByTime(1000);await Promise.resolve();await Promise.resolve();expect(mockReq.post).toHaveBeenCalledTimes(count);
  });
  test('successful cancellation resumes status reads after a transient failure until native ACK',async()=>{
    await store.start(reportRequest() as any);mockReq.post.mockRejectedValueOnce(new Error('Disconnected'));await store.read();
    await store.cancel();expect(store.cancelRequested).toBe(true);mockReq.post.mockResolvedValueOnce(wire(reportStatus('cancelled','cancelled')));
    jest.advanceTimersByTime(500);for(let i=0;i<12;i++)await Promise.resolve();
    expect(store.phase).toBe('cancelled');expect(store.cancelRequested).toBe(false);
  });
  test('explicit status retry clears the transient error and resumes polling',async()=>{
    await store.start(reportRequest() as any);mockReq.post.mockRejectedValueOnce(new Error('Disconnected'));await store.read();
    mockReq.post.mockResolvedValueOnce(wire(reportStatus('running')));await store.read();expect(store.errorReason).toBeNull();
    jest.advanceTimersByTime(500);for(let i=0;i<12;i++)await Promise.resolve();expect(store.phase).toBe('complete');
  });
  test('an old pending read cannot block the next run or publish its completed result',async()=>{
    await store.start(reportRequest() as any);const pending=deferred();mockReq.post.mockReturnValueOnce(pending.promise);const old=store.read();await Promise.resolve();await Promise.resolve();
    mockReq.post.mockImplementation((path:string)=>Promise.resolve(wire(path.endsWith('start')?{...reportStart(),run_id:'c'.repeat(32),capability:'d'.repeat(64)}:{schema_version:1,run_id:'a'.repeat(32),released:false})));await store.start(reportRequest() as any);
    pending.resolve(wire(reportStatus()));await old;expect(store.lastCompleted).toBeNull();
    mockReq.post.mockResolvedValueOnce(wire({...reportStatus(),run_id:'c'.repeat(32)}));await store.read();expect(store.phase).toBe('complete');expect(store.lastCompleted).not.toBeNull();
  });
  test('malformed native reads cannot replace a real completed snapshot',async()=>{
    await store.start(reportRequest() as any);await store.read();const previous=JSON.parse(JSON.stringify(store.lastCompleted));expect(previous).not.toBeNull();
    await store.start(reportRequest() as any);mockReq.post.mockResolvedValueOnce({data:JSON.stringify(reportStatus()).replace('"schema_version":1','"schema_version":1,"schema_version":1')});await store.read();expect(store.lastCompleted).toEqual(previous);expect(store.errorReason).toBe('invalid-response');
  });
  test('changed selection rejects a late import preview without reloading categories',async()=>{
    const pending=deferred();mockReq.post.mockReturnValueOnce(pending.promise);const preparing=store.previewImport({schema_version:1,templates:[],rule_packs:[],category_sets:[{id:'incoming',name:'Incoming',classes:[]}]});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();store.selectionChanged();pending.resolve(wire({schema_version:1,preview_id:'e'.repeat(32),mappings:[],proposed_library:reportLibrary(),expires_in_seconds:120}));await preparing;expect(store.preview).toBeNull();expect(mockCategories.load).not.toHaveBeenCalled();
  });
  test('newer metadata replies win and an older save cannot restore a library',async()=>{
    await store.load();const pending=deferred();mockReq.put.mockReturnValueOnce(pending.promise);const saving=store.save({schema_version:1,expected_revision:1,library:reportLibrary()});await Promise.resolve();await Promise.resolve();
    mockReq.get.mockResolvedValueOnce(wire({...reportLibrary(),revision:3}));await store.load();pending.resolve(wire({...reportLibrary(),revision:2}));await saving;expect(store.library?.revision).toBe(3);
  });
  test('an expired raw snapshot never refetches history or replaces retained totals',async()=>{
    await store.start(reportRequest() as any);await store.read();const before=JSON.parse(JSON.stringify(store.lastCompleted));mockReq.post.mockRejectedValueOnce({response:{data:'{"schema_version":1,"reason":"source-unavailable"}'}});
    await store.read({schema_version:1,run_id:'a'.repeat(32),include_raw_events:true});expect(store.rawUnavailable).toBe(true);expect(store.rawEvents).toBeNull();expect(store.lastCompleted).toEqual(before);expect(mockReq.post.mock.calls.every(call=>call[0].startsWith('/0/reports/'))).toBe(true);
  });
  test('hidden set/activation drafts block preview without overwriting or saving them',async()=>{
    mockCategories.category_sets.push({id:'unsaved',categories:[]});mockCategories.active_set_ids=['unsaved'];
    await store.previewImport({schema_version:1,templates:[],rule_packs:[],category_sets:[{id:'incoming',name:'Incoming',classes:[]}]});
    expect(store.errorReason).toBe('category-draft');expect(mockReq.post).not.toHaveBeenCalled();expect(mockSettings.load).not.toHaveBeenCalled();expect(mockCategories.load).not.toHaveBeenCalled();
  });
  test('failed import commit does not publish settings, categories or library',async()=>{
    const preview={schema_version:1,preview_id:'e'.repeat(32),mappings:[],proposed_library:reportLibrary(),expires_in_seconds:120};mockReq.post.mockResolvedValueOnce(wire(preview));await store.previewImport({schema_version:1,templates:[],rule_packs:[],category_sets:[{id:'incoming',name:'Incoming',classes:[]}]});
    mockReq.post.mockRejectedValueOnce({response:{data:'{"schema_version":1,"reason":"stale-configuration"}'}});await store.commitImport({schema_version:1,preview_id:'e'.repeat(32),accept:true});expect(mockSettings.load).not.toHaveBeenCalled();expect(mockCategories.load).not.toHaveBeenCalled();expect(store.library).toBeNull();
  });
  test('category edits made while commit waits survive the durable ACK',async()=>{
    const preview={schema_version:1,preview_id:'e'.repeat(32),mappings:[],proposed_library:reportLibrary(),expires_in_seconds:120};mockReq.post.mockResolvedValueOnce(wire(preview));await store.previewImport({schema_version:1,templates:[],rule_packs:[],category_sets:[{id:'incoming',name:'Incoming',classes:[]}]});
    const pending=deferred();mockReq.post.mockReturnValueOnce(pending.promise);const committing=store.commitImport({schema_version:1,preview_id:'e'.repeat(32),accept:true});for(let i=0;i<8;i++)await Promise.resolve();mockCategories.category_sets.push({id:'new-draft',categories:[]});pending.resolve(wire({...reportLibrary(),revision:2}));await committing;
    expect(mockCategories.category_sets.some(set=>set.id==='new-draft')).toBe(true);expect(mockCategories.load).not.toHaveBeenCalled();expect(mockSettings.load).not.toHaveBeenCalled();expect(store.errorReason).toBe('category-draft');
  });
  test('commit publishes categories and library only after a durable native ACK',async()=>{
    const preview={schema_version:1,preview_id:'e'.repeat(32),mappings:[],proposed_library:reportLibrary(),expires_in_seconds:120};mockReq.post.mockResolvedValueOnce(wire(preview));
    await store.previewImport({schema_version:1,templates:[],rule_packs:[],category_sets:[{id:'incoming',name:'Incoming',classes:[]}]});
    const pending=deferred();mockReq.post.mockReturnValueOnce(pending.promise);const committing=store.commitImport({schema_version:1,preview_id:'e'.repeat(32),accept:true});await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(mockSettings.load).not.toHaveBeenCalled();expect(mockCategories.load).not.toHaveBeenCalled();pending.resolve(wire({...reportLibrary(),revision:2}));await committing;
    expect(mockSettings.load).toHaveBeenCalledWith({save:false});expect(mockCategories.load).toHaveBeenCalled();expect(store.library?.revision).toBe(2);
  });
});

test('category calculation hash matches the independent native Unicode oracle',async()=>{
  const {webcrypto}=require('crypto');Object.defineProperty(global,'crypto',{configurable:true,value:webcrypto});
  const {reportCategoryFingerprint}=require('~/util/reportContracts');
  expect(await reportCategoryFingerprint([{name:['Łódź'],rule:{type:'regex',regex:'Editor'}},{name:['Other'],rule:{type:null}}])).toBe('8922fc6e38273b095442628768049064f2acdd938408dbff2253d1559df826c5');
});
