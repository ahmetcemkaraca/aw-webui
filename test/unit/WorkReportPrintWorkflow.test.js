import { createLocalVue, shallowMount } from '@vue/test-utils';
import { BootstrapVue } from 'bootstrap-vue';
import { createPinia, setActivePinia } from 'pinia';
import WorkReport from '~/views/WorkReport.vue';
import { useCategoryStore } from '~/stores/categories';
import { useBucketsStore } from '~/stores/buckets';
import { useVaultStore } from '~/stores/vault';
import { getClient } from '~/util/awclient';
import { loadNativeEntitlementStatus } from '~/util/entitlement';
import { calculateFocusBlocks, calculateContextSwitches, calculateMeetingLoad } from '~/util/workReport';

jest.mock('~/util/awclient', () => ({ getClient: jest.fn(), clearLocalSession: jest.fn() }));
jest.mock('~/util/entitlement', () => ({ ...jest.requireActual('~/util/entitlement'), loadNativeEntitlementStatus: jest.fn() }));

const localVue = createLocalVue(); localVue.use(BootstrapVue);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function reportData() {
  const daily = [{ date: '2026-10-13', duration: 3600, sessions: 2, avgSession: 1800, events: [{ timestamp: '2026-10-13T09:00:00Z', duration: 60, data: { title: 'RAW-PRIVATE-SECRET' } }] }];
  return {
    dailyData: daily,
    focusBlocks: calculateFocusBlocks(daily), contextSwitches: calculateContextSwitches(daily), meetingLoad: calculateMeetingLoad(daily, [['Work']]),
    rawData: [[{ data: { title: 'RAW-PRIVATE-SECRET' } }]], includeRawEvents: true,
    calculationManifest: { schema_version: 1, method_id: 'work-time', method_version: 1, host_ids: ['original-host'], category_paths: [['Work']], break_time_seconds: 300,
      date_range: 'last7d', start_of_day: '04:00', coverage: { periods_with_events: 1, requested_periods: 7, events_seen: 1, limitation: 'Capture may be missing.' } },
    sourceCoverage: { source_health: 'unknown', available_source_buckets: [], queried_source_buckets: [], timezone: 'Europe/Berlin', partial_periods: [], clock_skew: { status: 'unknown', correction_bound_seconds: 0 }, source_row_limit: 100, report_row_limit: 100, limited_periods: [], queried_periods: ['original-period'] },
    weeklyData: [{ period: 'week', duration: 3600 }], monthlyData: [{ period: 'month', duration: 3600 }],
  };
}

describe('free Work Report print workflow', () => {
  let wrapper;
  let print;
  let request;
  beforeEach(() => {
    setActivePinia(createPinia());
    jest.spyOn(useCategoryStore(), 'load').mockReturnValue(undefined);
    jest.spyOn(useBucketsStore(), 'ensureLoaded').mockResolvedValue(undefined);
    useVaultStore().status = { state: 'ready', has_vault: true, generation: 1, message: null };
    loadNativeEntitlementStatus.mockResolvedValue(null);
    request = { get: jest.fn().mockResolvedValue({ data: { schema_version: 1, projects: [], category_rules: [] } }), post: jest.fn() };
    getClient.mockReturnValue({ req: request });
    print = jest.spyOn(window, 'print').mockImplementation(() => {});
  });
  afterEach(() => { wrapper?.destroy(); wrapper = null; window.dispatchEvent(new Event('afterprint')); jest.restoreAllMocks(); });
  async function mountReport() {
    wrapper = shallowMount(WorkReport, { localVue, stubs: ['icon'] });
    await flush(); await wrapper.setData(reportData());
    return wrapper.findAllComponents({ name: 'BButton' }).wrappers.find(button => button.text().includes('Print / save Work Report as PDF'));
  }

  test('mounted basic mode supports the synchronous category loader and managed mode entry',async()=>{
    await mountReport();expect(wrapper.vm.calculationError).toBe('');
    await wrapper.setData({reportMode:'advanced'});expect(wrapper.findComponent({name:'AdvancedReportPanel'}).exists()).toBe(true);
    const count=request.post.mock.calls.length;await wrapper.vm.loadData();expect(request.post).toHaveBeenCalledTimes(count);
  });

  test('free action prints completed export metadata, ignores raw opt-in and makes no new requests', async () => {
    const action = await mountReport();
    expect(!!action).toBe(true);
    expect(wrapper.vm.freelancerAvailable).toBe(false);
    const getCount = request.get.mock.calls.length; const entitlementCount = loadNativeEntitlementStatus.mock.calls.length;
    const download = jest.spyOn(wrapper.vm, 'downloadFile').mockImplementation(() => {});
    wrapper.vm.exportJSON();
    const expected = JSON.parse(download.mock.calls[0][0]); delete expected.rawEvents;
    await action.trigger('click'); await wrapper.vm.$nextTick();
    const portal = document.getElementById('work-report-print');
    expect(JSON.parse(portal.querySelector('pre').textContent)).toEqual(expected);
    expect(portal.textContent).not.toContain('RAW-PRIVATE-SECRET');
    expect(print).toHaveBeenCalledTimes(1);
    expect(request.get).toHaveBeenCalledTimes(getCount); expect(request.post).not.toHaveBeenCalled();
    expect(loadNativeEntitlementStatus).toHaveBeenCalledTimes(entitlementCount);
    expect(wrapper.text()).not.toMatch(/PDF saved|export successful/i);
    const frozen = portal.textContent;
    await wrapper.setData({ selectedHosts: ['new-host'], dateRange: 'last30d', breakTime: 25, dailyData: [{ date: 'new-date', duration: 1, sessions: 1, avgSession: 1, events: [] }] });
    expect(portal.textContent).toBe(frozen);
  });

  test('duplicate work prints and signed-timesheet print cannot replace the active report', async () => {
    expect(!!await mountReport()).toBe(true);
    wrapper.vm.printWorkReport(); wrapper.vm.printWorkReport();
    await wrapper.setData({ signedClientReport: { timesheet: { project_alias: 'alpha', date: '2026-10-13', approved_duration_seconds: 60 }, artifact_sha256: 'a', signer_public_key_ed25519: 'b', signature_ed25519: 'c' } });
    wrapper.vm.printSignedClientReport();
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('timesheet-print-mode')).toBe(false);
    window.dispatchEvent(new Event('afterprint')); await wrapper.vm.$nextTick();
    expect(wrapper.vm.workReportPrinting).toBe(false);
  });

  test.each(['destroy', 'lock'])('%s removes private print data and mode', async kind => {
    expect(!!await mountReport()).toBe(true);
    wrapper.vm.printWorkReport();
    if (kind === 'destroy') { wrapper.destroy(); wrapper = null; }
    else { useVaultStore().status = { state: 'locked', has_vault: true, generation: 1, message: null }; await wrapper.vm.$nextTick(); }
    expect(document.getElementById('work-report-print')).toBeNull();
    expect(document.body.classList.contains('work-report-print-mode')).toBe(false);
  });

  test('locking clears the portal immediately and blocks reprinting during or after lock', async () => {
    expect(!!await mountReport()).toBe(true);
    wrapper.vm.printWorkReport();
    useVaultStore().busy = true;
    await wrapper.vm.$nextTick();
    expect(document.getElementById('work-report-print')).toBeNull();
    wrapper.vm.printWorkReport();
    expect(document.getElementById('work-report-print')).toBeNull();
    useVaultStore().busy = false;
    useVaultStore().status = { state: 'locked', has_vault: true, generation: 1, message: null };
    await wrapper.vm.$nextTick();
    wrapper.vm.printWorkReport();
    expect(document.getElementById('work-report-print')).toBeNull();
  });

  test('throwing print reports finite CSV/JSON fallback and clears busy state', async () => {
    expect(!!await mountReport()).toBe(true);
    print.mockImplementation(() => { throw new Error('/private/platform/error'); });
    wrapper.vm.printWorkReport(); await wrapper.vm.$nextTick();
    expect(wrapper.vm.workReportPrinting).toBe(false);
    expect(wrapper.text()).toContain('Use CSV or JSON export');
    expect(wrapper.text()).not.toContain('/private/platform/error');
    expect(document.getElementById('work-report-print')).toBeNull();
  });
});
