import { createLocalVue,mount } from '@vue/test-utils';
import AdvancedReportPanel from '~/components/AdvancedReportPanel.vue';
import { reportLibrary,reportCompleted } from './fixtures/reports';
const mockStore={library:null,preview:null,lastCompleted:null,runId:null,completedRunId:'a'.repeat(32),capability:null,phase:'idle',runStatus:null,busy:false,errorReason:null,cancelRequested:false,rawEvents:null,rawUnavailable:false,exported:null,load:jest.fn(),save:jest.fn(),remove:jest.fn(),exportLibrary:jest.fn(),previewImport:jest.fn(),commitImport:jest.fn(),start:jest.fn(),read:jest.fn(),cancel:jest.fn(),dispose:jest.fn(),selectionChanged:jest.fn(),clearSensitive:jest.fn()};
const mockVault={isReady:true,busy:false};const mockCategories={category_sets:[{id:'default',categories:[]}],allCategoriesSelect:[]};
jest.mock('~/stores/reports',()=>({useReportStore:()=>mockStore}));
jest.mock('~/stores/vault',()=>({useVaultStore:()=>mockVault}));
jest.mock('~/stores/categories',()=>({useCategoryStore:()=>mockCategories}));
jest.mock('~/util/entitlement',()=>({...jest.requireActual('~/util/entitlement'),loadNativeEntitlementStatus:jest.fn()}));
jest.mock('~/product/experience',()=>({capability:()=>({status:'Available'})}));
import { loadNativeEntitlementStatus } from '~/util/entitlement';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
describe('reviewed native report panel',()=>{
  let wrapper;beforeEach(()=>{jest.clearAllMocks();mockStore.library=reportLibrary();mockStore.lastCompleted=reportCompleted();mockStore.phase='idle';mockStore.errorReason=null;mockVault.isReady=true;mockVault.busy=false;loadNativeEntitlementStatus.mockResolvedValue(null);});afterEach(()=>wrapper?.destroy());
  async function setup(){wrapper=mount(AdvancedReportPanel,{localVue:createLocalVue(),propsData:{hostIds:['Host'],startOfDay:'00:00'}});await flush();}
  test('keeps metadata read/export/delete and frozen downloads available after expiry',async()=>{
    await setup();expect(wrapper.find('[data-report-run]').attributes('disabled')).toBeDefined();
    for(const attr of ['data-library-reload','data-library-export','data-template-remove','data-report-csv','data-report-json','data-report-print'])expect(wrapper.find(`[${attr}]`).attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('Local Pro or Pro');
  });
  test('can actually submit186 current days using frozen host order and no query/limit override',async()=>{
    loadNativeEntitlementStatus.mockResolvedValue({plan_id:'local-pro',feature_ids:['advanced-reports'],access:'current'});await setup();
    await wrapper.setData({startDate:'2026-01-01',endDate:'2026-07-05',selectedTemplateId:'work'});await wrapper.find('[data-report-run]').trigger('click');await flush();
    const request=mockStore.start.mock.calls[0][0];expect(request.current_periods).toHaveLength(186);expect(request.previous_periods).toBeNull();expect(request.ordered_host_ids).toEqual(['Host']);expect(request).not.toHaveProperty('query');expect(request).not.toHaveProperty('limits');
  });
  test('pack updates require reviewed dependent pin repairs',async()=>{
    Object.defineProperty(global,'crypto',{configurable:true,value:require('crypto').webcrypto});Object.defineProperty(global,'TextEncoder',{configurable:true,value:require('util').TextEncoder});
    loadNativeEntitlementStatus.mockResolvedValue({plan_id:'pro',feature_ids:['advanced-reports'],access:'current'});
    mockStore.library.rule_packs=[{id:'rules',name:'Rules',content_version:1,category_sets:[{id:'default',calculation_sha256:'1'.repeat(64)}]}];mockStore.library.templates[0].rule_pack={id:'rules',content_version:1};await setup();
    wrapper.vm.editPack(mockStore.library.rule_packs[0]);wrapper.vm.draftName='Changed';await wrapper.vm.saveEditor();expect(mockStore.save).not.toHaveBeenCalled();expect(wrapper.vm.formError).toContain('Review linked');
    wrapper.vm.repairPins=true;await wrapper.vm.saveEditor();const next=mockStore.save.mock.calls[0][0].library;expect(next.rule_packs[0].content_version).toBe(2);expect(next.templates[0].rule_pack.content_version).toBe(2);expect(next.templates[0].content_version).toBe(2);
  });
  test('pack deletion explicitly lists included dependent templates before acting',async()=>{
    mockStore.library.rule_packs=[{id:'rules',name:'Rules',content_version:1,category_sets:[]}];mockStore.library.templates[0].rule_pack={id:'rules',content_version:1};await setup();wrapper.vm.reviewRemoval('rule-pack','rules');await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('linked templates: Work');expect(mockStore.remove).not.toHaveBeenCalled();await wrapper.vm.confirmRemoval();expect(mockStore.remove).toHaveBeenCalledWith('rule-pack','rules');
  });
  test('locking clears local editor fields and a private PDF portal',async()=>{
    await setup();const print=jest.spyOn(window,'print').mockImplementation(()=>{});wrapper.vm.editTemplate(mockStore.library.templates[0]);wrapper.vm.printReport();expect(document.getElementById('work-report-print')).not.toBeNull();
    mockVault.isReady=false;await wrapper.vm.$nextTick();expect(wrapper.vm.draftName).toBe('');expect(document.getElementById('work-report-print')).toBeNull();expect(mockStore.clearSensitive).toHaveBeenCalled();print.mockRestore();
  });
  test('formats only the frozen native artifact after current controls change',async()=>{
    await setup();const download=jest.spyOn(wrapper.vm,'downloadFile').mockImplementation(()=>{});wrapper.vm.exportCSV();await wrapper.vm.exportJSON();const before=download.mock.calls.map(call=>call[0]);download.mockClear();
    await wrapper.setData({startDate:'2025-01-01',endDate:'2025-02-01',selectedTemplateId:'different'});wrapper.vm.exportCSV();await wrapper.vm.exportJSON();expect(download.mock.calls.map(call=>call[0])).toEqual(before);expect(before[1]).not.toContain('capability');
  });
  test('a failed library export never downloads a prior package',async()=>{
    await setup();mockStore.exported={package:{schema_version:1,templates:[],rule_packs:[],category_sets:[]}};mockStore.exportLibrary.mockResolvedValue(undefined);
    const download=jest.spyOn(wrapper.vm,'downloadFile').mockImplementation(()=>{});await wrapper.vm.exportLibrary();expect(download).not.toHaveBeenCalled();
  });
  test('offers status retry after a transient failure without replacing the run',async()=>{
    await setup();mockStore.phase='running';mockStore.errorReason='source-unavailable';await wrapper.vm.$nextTick();
    await wrapper.find('[data-report-retry]').trigger('click');expect(mockStore.read).toHaveBeenCalledWith();expect(mockStore.start).not.toHaveBeenCalled();
  });
});
