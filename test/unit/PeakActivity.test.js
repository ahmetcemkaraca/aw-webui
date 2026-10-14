import { createLocalVue, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { BootstrapVue } from 'bootstrap-vue';
import Home from '~/views/Home.vue';
import App from '~/App.vue';
import Footer from '~/components/Footer.vue';
import Settings from '~/views/settings/Settings.vue';
import Freelancer from '~/views/Freelancer.vue';
import WorkReport from '~/views/WorkReport.vue';
import { useCategoryStore } from '~/stores/categories';
import { useBucketsStore } from '~/stores/buckets';
import { getClient } from '~/util/awclient';
import { downloadFile } from '~/util/export';
import { loadNativeEntitlementStatus } from '~/util/entitlement';
import experience from '~/generated/product-experience.json';
import { FREELANCER_TIMESHEET_EGRESS_PURPOSE_V1, serializeApprovedTimesheet } from '~/util/freelancer';
import { calculateContextSwitches, calculateFocusBlocks, calculateMeetingLoad } from '~/util/workReport';
import { TextEncoder } from 'util';

jest.mock('~/util/awclient', () => ({ getClient: jest.fn() }));
jest.mock('~/util/export', () => ({ downloadFile: jest.fn() }));
jest.mock('~/util/entitlement', () => ({
  ...jest.requireActual('~/util/entitlement'),
  loadNativeEntitlementStatus: jest.fn(),
}));

describe('PeakActivity bootstrap surfaces', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('home offers local navigation without upstream surveys or support links', () => {
    const wrapper = shallowMount(Home, { stubs: ['router-link'] });
    expect(wrapper.text()).toContain('PeakActivity');
    expect(wrapper.text()).toContain('Home / Today');
    expect(wrapper.text()).toContain('Local Vault');
    expect(wrapper.text()).toContain('Reports');
    expect(wrapper.text()).toContain('Manual timer');
    expect(wrapper.text()).toContain('Experimental');
    expect(wrapper.find('[role="status"][aria-live="polite"]').exists()).toBe(true);
    expect(wrapper.find('nav[aria-label="PeakActivity destinations"]').exists()).toBe(true);
    expect(wrapper.findAll('a[href^="http"]')).toHaveLength(0);
    expect(wrapper.text()).not.toMatch(/donate|survey|desktop parity/i);
  });

  test('Home summary includes only activity labels and durations', () => {
    const activity = {
      window: { top_apps: [{ data: { app: 'Editor', title: 'private title' }, duration: 120 }] },
      category: { top: [{ data: { $category: ['Work', 'Writing'] }, duration: 60 }] },
      stopwatch: { top_stopwatches: [{ data: { label: 'Deep work' }, duration: 90 }] },
    };
    const topApps = Home.computed.topApps.call({ activity });
    const topCategories = Home.computed.topCategories.call({ activity });
    const topManualEntries = Home.computed.topManualEntries.call({ activity });
    expect(topApps).toEqual([{ label: 'Editor', duration: 120 }]);
    expect(topCategories).toEqual([{ label: 'Work > Writing', duration: 60 }]);
    expect(topManualEntries).toEqual([{ label: 'Deep work', duration: 90 }]);
    expect(JSON.stringify(topApps)).not.toContain('private title');
  });

  test('explore without recording completes setup only after the vault is ready', async () => {
    const complete = jest.fn();
    await App.methods.exploreWithoutRecording.call({
      unlock: jest.fn().mockResolvedValue(undefined),
      vaultStore: { isReady: false },
      completeOnboarding: complete,
    });
    expect(complete).not.toHaveBeenCalled();
    await App.methods.exploreWithoutRecording.call({
      unlock: jest.fn().mockResolvedValue(undefined),
      vaultStore: { isReady: true },
      completeOnboarding: complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test('footer exposes local About and preserves derivative attribution', () => {
    const wrapper = shallowMount(Footer, { stubs: ['router-link'] });
    expect(wrapper.text()).toContain('ActivityWatch');
    expect(wrapper.text()).toContain('independent');
    expect(wrapper.findAll('a[href^="http"]')).toHaveLength(0);
    expect(wrapper.find('router-link-stub').attributes('to')).toBe('/about');
  });

  test('settings cannot re-enable the removed upstream release checker', () => {
    const groups = Settings.computed.groups.call({ $isAndroid: false });
    expect(groups.flatMap(group => group.components.map(component => component.name)))
      .not.toContain('ReleaseNotificationSettings');
  });

  test('privacy settings reflect the outbound firewall capability status', () => {
    const groups = Settings.computed.groups.call({ $isAndroid: false });
    expect(groups.find(group => group.id === 'privacy').help).toContain('Privacy Firewall approvals and receipts: Planned');
    expect(groups.find(group => group.id === 'privacy').components.map(component => component.name))
      .toContain('PrivacyFirewallSettings');
  });
});

describe('Freelancer access lifecycle', () => {
  const localVue = createLocalVue();
  localVue.use(BootstrapVue);
  const freelancerCapability = experience.capabilities.find(item => item.id === 'freelancer-workspace');
  const originalStatus = freelancerCapability.status;
  const entitlement = { plan_id: 'freelancer', feature_ids: ['freelancer-workspace'], access: 'current' };
  const request = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  let workspace;
  let wrapper;

  async function mountReportWithArtifacts() {
    wrapper = shallowMount(WorkReport, { localVue, stubs: ['icon'] });
    await flush();
    const timesheet = { schema_version: 1, project_alias: 'alpha', date: '2026-10-13', approved_duration_seconds: 60, user_note: 'Frozen note' };
    const preview = { timesheet, artifact_json: serializeApprovedTimesheet(timesheet), artifact_sha256: 'a'.repeat(64) };
    const signed = { timesheet, artifact_sha256: preview.artifact_sha256, signer_public_key_ed25519: 'b'.repeat(64), signature_ed25519: 'c'.repeat(128) };
    const daily = [{
      date: '2026-10-13', duration: 60, sessions: 1, avgSession: 60,
      events: [{ timestamp: '2026-10-13T09:00:00Z', duration: 60, data: { $category: ['Work'] } }],
    }];
    const purposeId = FREELANCER_TIMESHEET_EGRESS_PURPOSE_V1;
    await wrapper.setData({
      dailyData: daily,
      calculationManifest: { coverage: { periods_with_events: 1, requested_periods: 1, events_seen: 1 } },
      focusBlocks: calculateFocusBlocks(daily), contextSwitches: calculateContextSwitches(daily), meetingLoad: calculateMeetingLoad(daily, [['Work']]),
      selectedTimesheetLineKey: 'alpha\u00002026-10-13', timesheetDurationSeconds: 60, timesheetNote: 'Frozen note',
      timesheetEgressPolicy: {
        destinations: [{ id: 'client', status: 'available', https_origin: 'https://client.example.test', allowed_purposes: [purposeId] }],
        purposes: [{ id: purposeId, destination_id: 'client', retention_id: 'review', retention_disclosure: 'Review only', allowed_fields: [] }],
      },
      selectedTimesheetEgressPurposeId: purposeId, timesheetEgressOutboundEnabled: true,
    });
    await wrapper.setData({
      timesheetPreview: preview, signedClientReport: signed,
      timesheetEgressPreview: { decision: { outcome: 'allow', sanitized_payload: timesheet, removed_fields: [], reason_codes: [], preview_id: 'preview-1' } },
      timesheetEgressApprovalConfirmed: true,
    });
    return { preview, signed };
  }

  beforeEach(() => {
    global.TextEncoder = TextEncoder;
    setActivePinia(createPinia());
    jest.spyOn(useCategoryStore(), 'load').mockResolvedValue(undefined);
    jest.spyOn(useBucketsStore(), 'ensureLoaded').mockResolvedValue(undefined);
    workspace = {
      schema_version: 1, revision: 4,
      projects: ['alpha', 'beta'].map(project_alias => ({
        project_alias, label: `Private ${project_alias}`, client_alias: null,
        billable_default: true, rounding_mode: 'none', rounding_increment_seconds: 0,
        currency_code: null, hourly_rate_minor: null, hourly_cost_minor: null,
      })),
      category_rules: [
        { category_path: ['Work'], project_alias: 'alpha' },
        { category_path: ['Other'], project_alias: 'beta' },
      ],
    };
    freelancerCapability.status = 'Available';
    loadNativeEntitlementStatus.mockReset().mockResolvedValue(entitlement);
    request.get.mockReset().mockImplementation(() => Promise.resolve({ data: JSON.parse(JSON.stringify(workspace)) }));
    request.post.mockReset();
    request.put.mockReset().mockImplementation((url, body) => Promise.resolve({ data: body.workspace }));
    getClient.mockReturnValue({ req: request });
    downloadFile.mockClear();
  });

  afterEach(() => {
    wrapper?.destroy();
    wrapper = null;
    freelancerCapability.status = originalStatus;
  });

  test.each(['Planned', 'Available'])('saved workspace remains readable, exportable and removable when %s has no access', async status => {
    freelancerCapability.status = status;
    loadNativeEntitlementStatus.mockResolvedValue(null);
    jest.spyOn(useCategoryStore(), 'load').mockRejectedValue(new Error('Category settings unavailable'));
    wrapper = shallowMount(Freelancer, { localVue });
    await flush();
    expect(request.get).toHaveBeenCalledWith('/0/freelancer/workspace');
    expect(wrapper.text()).toContain('Private alpha');
    expect(wrapper.vm.freelancerAvailable).toBe(false);
    await wrapper.vm.exportWorkspace();
    expect(downloadFile).toHaveBeenCalledWith('freelancer-project-settings.json', JSON.stringify(workspace, null, 2), 'application/json');
    wrapper.vm.removeProject('alpha');
    await wrapper.vm.saveWorkspace();
    expect(request.put).toHaveBeenCalledWith('/0/freelancer/workspace', {
      expected_revision: 4,
      workspace: { ...workspace, projects: [workspace.projects[1]], category_rules: [workspace.category_rules[1]] },
    });
    expect(loadNativeEntitlementStatus).toHaveBeenCalledTimes(1);
  });

  test('a failed workspace read cannot establish a deletion baseline', async () => {
    loadNativeEntitlementStatus.mockResolvedValue(null);
    request.get.mockRejectedValue(new Error('Vault locked'));
    wrapper = shallowMount(Freelancer, { localVue });
    await flush();
    wrapper.vm.removeProject('alpha');
    await wrapper.vm.saveWorkspace();
    expect(request.put).not.toHaveBeenCalled();
  });

  test('free deletion preserves the order of exact retained records and permits an unchanged no-op', async () => {
    workspace.projects.push({ ...workspace.projects[1], project_alias: 'gamma', label: 'Private gamma' });
    workspace.category_rules.push({ category_path: ['Third'], project_alias: 'gamma' });
    wrapper = shallowMount(Freelancer, { localVue });
    await flush();
    loadNativeEntitlementStatus.mockResolvedValue(null);
    wrapper.vm.removeProject('beta');
    wrapper.vm.workspace.projects.reverse();
    expect(wrapper.vm.removalOnly).toBe(false);
    await wrapper.vm.saveWorkspace();
    expect(request.put).not.toHaveBeenCalled();
    wrapper.vm.workspace.projects.reverse();
    wrapper.vm.workspace.category_rules.reverse();
    expect(wrapper.vm.removalOnly).toBe(false);
    await wrapper.vm.saveWorkspace();
    expect(request.put).not.toHaveBeenCalled();
    wrapper.vm.workspace.category_rules.reverse();
    expect(wrapper.vm.removalOnly).toBe(true);
    await wrapper.vm.saveWorkspace();
    expect(request.put).toHaveBeenCalledTimes(1);
    wrapper.vm.dirty = true;
    expect(wrapper.vm.removalOnly).toBe(true);
    await wrapper.vm.saveWorkspace();
    expect(request.put).toHaveBeenCalledTimes(2);
  });

  test('expiry stops new local project edits and preserves input', async () => {
    wrapper = shallowMount(Freelancer, { localVue });
    await flush();
    await wrapper.setData({ draft: { ...wrapper.vm.draft, label: 'Unsaved work', project_alias: 'draft', category_paths: [['New']] } });
    loadNativeEntitlementStatus.mockResolvedValue(null);
    await wrapper.vm.addProject();
    expect(loadNativeEntitlementStatus).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.workspace.projects).toHaveLength(2);
    expect(wrapper.vm.draft.label).toBe('Unsaved work');
    expect(wrapper.vm.freelancerAvailable).toBe(false);
  });

  test('a denied paid save preserves corrections and does not grant a removal-only save', async () => {
    wrapper = shallowMount(Freelancer, { localVue });
    await flush();
    wrapper.vm.workspace.projects[0].label = 'Unsaved correction';
    wrapper.vm.dirty = true;
    let finishAccessCheck;
    loadNativeEntitlementStatus.mockImplementationOnce(() => new Promise(resolve => { finishAccessCheck = resolve; }));
    let denySave;
    request.put.mockImplementationOnce(() => new Promise((resolve, reject) => { denySave = reject; }));
    const saving = wrapper.vm.saveWorkspace();
    expect(wrapper.vm.saving).toBe(true);
    await wrapper.vm.saveWorkspace();
    expect(loadNativeEntitlementStatus).toHaveBeenCalledTimes(2);
    finishAccessCheck(entitlement);
    await flush();
    let finishStaleCheck;
    loadNativeEntitlementStatus.mockImplementationOnce(() => new Promise(resolve => { finishStaleCheck = resolve; }));
    const staleCheck = wrapper.vm.refreshFreelancerEntitlement();
    denySave({ response: { status: 403 } });
    await saving;
    finishStaleCheck(entitlement);
    expect(await staleCheck).toBe(false);
    expect(wrapper.vm.freelancerAvailable).toBe(false);
    expect(wrapper.vm.workspace.projects[0].label).toBe('Unsaved correction');
    expect(wrapper.vm.dirty).toBe(true);
    loadNativeEntitlementStatus.mockResolvedValue(null);
    wrapper.vm.removeProject('beta');
    await wrapper.vm.saveWorkspace();
    expect(request.put).toHaveBeenCalledTimes(1);
  });

  test('a denied signing action leaves the exact approved and signed artifacts exportable', async () => {
    const { preview, signed } = await mountReportWithArtifacts();
    let finishAccessCheck;
    loadNativeEntitlementStatus.mockImplementationOnce(() => new Promise(resolve => { finishAccessCheck = resolve; }));
    let denySign;
    request.post.mockImplementationOnce(() => new Promise((resolve, reject) => { denySign = reject; }));
    const signing = wrapper.vm.signApprovedTimesheet();
    expect(wrapper.vm.timesheetSigning).toBe(true);
    await wrapper.vm.signApprovedTimesheet();
    expect(loadNativeEntitlementStatus).toHaveBeenCalledTimes(2);
    finishAccessCheck(entitlement);
    await flush();
    let finishStaleCheck;
    loadNativeEntitlementStatus.mockImplementationOnce(() => new Promise(resolve => { finishStaleCheck = resolve; }));
    const staleCheck = wrapper.vm.refreshFreelancerEntitlement();
    denySign({ response: { status: 403 } });
    await signing;
    finishStaleCheck(entitlement);
    expect(await staleCheck).toBe(false);
    expect(wrapper.vm.freelancerAvailable).toBe(false);
    expect(wrapper.vm.timesheetPreview).toEqual(preview);
    expect(wrapper.vm.signedClientReport).toEqual(signed);
    expect(wrapper.find('section[aria-labelledby="approved-timesheet-preview-title"]').exists()).toBe(true);
    expect(wrapper.find('section[aria-labelledby="signed-client-report-title"]').exists()).toBe(true);
    const saveFile = jest.spyOn(wrapper.vm, 'downloadFile').mockImplementation(() => {});
    wrapper.vm.exportApprovedTimesheet();
    wrapper.vm.exportSignedClientReport();
    wrapper.vm.exportCSV();
    wrapper.vm.exportJSON();
    expect(saveFile).toHaveBeenCalledWith(preview.artifact_json, 'approved-timesheet-alpha-2026-10-13.json', 'application/json');
    expect(saveFile).toHaveBeenCalledWith(JSON.stringify(signed), 'signed-timesheet-alpha-2026-10-13.json', 'application/json');
    expect(saveFile).toHaveBeenCalledTimes(4);
    loadNativeEntitlementStatus.mockResolvedValue(null);
    request.post.mockClear();
    await wrapper.vm.signApprovedTimesheet();
    expect(request.post).not.toHaveBeenCalled();
  });

  test.each([
    ['previewApprovedTimesheet', 'timesheetLoading'],
    ['signApprovedTimesheet', 'timesheetSigning'],
    ['previewTimesheetEgress', 'timesheetEgressBusy'],
    ['approveAndSendTimesheet', 'timesheetEgressBusy'],
  ])('%s rechecks expiry before any mutation and preserves artifacts', async (method, busyFlag) => {
    const { preview, signed } = await mountReportWithArtifacts();
    let finishAccessCheck;
    loadNativeEntitlementStatus.mockImplementationOnce(() => new Promise(resolve => { finishAccessCheck = resolve; }));
    request.post.mockClear();
    const action = wrapper.vm[method]();
    expect(wrapper.vm[busyFlag]).toBe(true);
    await wrapper.vm[method]();
    expect(loadNativeEntitlementStatus).toHaveBeenCalledTimes(2);
    finishAccessCheck(null);
    await action;
    expect(wrapper.vm[busyFlag]).toBe(false);
    expect(request.post).not.toHaveBeenCalled();
    expect(wrapper.vm.freelancerAvailable).toBe(false);
    expect(wrapper.vm.timesheetNote).toBe('Frozen note');
    expect(wrapper.vm.timesheetPreview).toEqual(preview);
    expect(wrapper.vm.signedClientReport).toEqual(signed);
  });

  test('a native entitlement cannot enable a Planned catalog capability', async () => {
    freelancerCapability.status = 'Planned';
    wrapper = shallowMount(WorkReport, { localVue, stubs: ['icon'] });
    await flush();
    expect(request.get).toHaveBeenCalledWith('/0/freelancer/workspace');
    expect(wrapper.vm.freelancerAvailable).toBe(false);
    await wrapper.vm.previewApprovedTimesheet();
    expect(request.post).not.toHaveBeenCalled();
  });

  test('a malformed comparison keeps the previous report and its exact exports available', async () => {
    useBucketsStore().buckets = [
      { id: 'aw-watcher-window_laptop', hostname: 'laptop', type: 'currentwindow', data: {} },
      { id: 'aw-watcher-afk_laptop', hostname: 'laptop', type: 'afkstatus', data: {} },
    ];
    wrapper = shallowMount(WorkReport, { localVue, stubs: ['icon'] });
    await flush();
    request.post.mockImplementationOnce((_url, { timeperiods }) => Promise.resolve({
      data: timeperiods.map(period => ({
        duration: 60,
        events: [{ timestamp: period.split('/')[0], duration: 60, data: { $category: ['Work'], app: 'Editor' } }],
      })),
    }));
    await wrapper.vm.loadData();
    expect(wrapper.vm.calculationStatus).toBe('complete');
    expect(wrapper.vm.totalDuration).toBe(420);
    expect(wrapper.vm.comparisonData.duration_change).toBe(0);

    const reportFields = [
      'dailyData', 'rawData', 'calculationManifest', 'comparisonData', 'comparisonUnavailable',
      'weeklyData', 'monthlyData', 'fieldSummaries', 'focusBlocks', 'contextSwitches',
      'meetingLoad', 'sourceCoverage',
    ];
    const previousReport = JSON.stringify(reportFields.map(field => wrapper.vm[field]));
    const previousAiAggregate = JSON.stringify(wrapper.vm.aiAggregate);
    await wrapper.setData({ includeRawEvents: true });
    const saveFile = jest.spyOn(wrapper.vm, 'downloadFile').mockImplementation(() => {});
    wrapper.vm.exportCSV();
    wrapper.vm.exportJSON();
    const previousExports = saveFile.mock.calls.slice();
    saveFile.mockClear();

    await wrapper.setData({ dateRange: 'last30d', breakTime: 1 });
    request.post.mockImplementationOnce((_url, { timeperiods }) => Promise.resolve({
      data: timeperiods.map((period, index) => index < 30 ? {
        duration: 1800,
        events: [{ timestamp: period.split('/')[0], duration: 1800, data: { $category: ['Work'], app: 'Browser' } }],
      } : { duration: -1, events: [] }),
    }));
    await wrapper.vm.loadData();

    expect(wrapper.vm.calculationStatus).toBe('failed');
    expect(wrapper.vm.calculationError).toContain('previous report data is still available');
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.queryController).toBeNull();
    expect(wrapper.vm.totalDuration).toBe(420);
    expect(JSON.stringify(reportFields.map(field => wrapper.vm[field]))).toBe(previousReport);
    expect(JSON.stringify(wrapper.vm.aiAggregate)).toBe(previousAiAggregate);
    wrapper.vm.exportCSV();
    wrapper.vm.exportJSON();
    expect(saveFile.mock.calls).toEqual(previousExports);
  });
});
