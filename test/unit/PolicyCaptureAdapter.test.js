import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Capture from '~/components/CaptureControls.vue';
import { useCaptureStore } from '~/stores/capture';
import { clearPolicyDrafts, hasPolicyDrafts, reloadPolicyDrafts } from '~/util/policyDrafts';
const mockGet = jest.fn();
jest.mock('~/util/awclient', () => ({ getClient: () => ({ req: { get: mockGet } }) }));
const policy = () => ({
  revision: 1,
  recording: false,
  paused_until: null,
  window: true,
  idle: true,
  browser: false,
  titles: false,
  urls: false,
  paths: false,
  excluded_apps: [],
  excluded_domains: [],
  effective_from: '2026-10-14T00:00:00Z',
});
let wrapper;
beforeEach(() => {
  setActivePinia(createPinia());
  clearPolicyDrafts();
  mockGet.mockReset();
  const store = useCaptureStore();
  store.policy = policy();
  jest.spyOn(store, 'load').mockResolvedValue(undefined);
});
afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  clearPolicyDrafts();
  jest.restoreAllMocks();
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test('dirty capture controls remain guarded independently of newly accepted live policy', async () => {
  wrapper = shallowMount(Capture, { propsData: { compact: false } });
  await flush();
  expect(hasPolicyDrafts()).toBe(false);
  await wrapper.setData({ apps: 'private draft' });
  expect(hasPolicyDrafts()).toBe(true);
  useCaptureStore().policy = { ...policy(), titles: true };
  expect(await reloadPolicyDrafts('capture.minimization', async () => true)).toBe(false);
  expect(wrapper.vm.apps).toBe('private draft');
});
test('clean capture adapter loads only authoritative policy and never resumes recording', async () => {
  wrapper = shallowMount(Capture, { propsData: { compact: false } });
  await flush();
  const remote = { ...policy(), revision: 2, titles: true };
  mockGet.mockResolvedValue({ data: { policy: remote, recording: false } });
  expect(await reloadPolicyDrafts('capture.minimization', async () => true)).toBe(true);
  expect(wrapper.vm.draft.titles).toBe(true);
  expect(useCaptureStore().recording).toBe(false);
  expect(mockGet).toHaveBeenCalledWith('/0/capture/');
});
test('late capture policy cannot apply after the caller loses ownership', async () => {
  const store = useCaptureStore();
  let done;
  mockGet.mockReturnValue(
    new Promise(resolve => {
      done = resolve;
    })
  );
  let current = true;
  const loading = store.reloadPolicy(async () => current);
  current = false;
  done({ data: { policy: { ...policy(), titles: true }, recording: true } });
  expect(await loading).toBe(false);
  expect(store.policy.titles).toBe(false);
  expect(store.recording).toBe(false);
});
test('failed capture read cannot report successful editor reload',async()=>{
 wrapper=shallowMount(Capture,{propsData:{compact:false}});await flush();mockGet.mockRejectedValue(new Error('synthetic read failure'));await expect(reloadPolicyDrafts('capture.minimization',async()=>true)).rejects.toThrow();expect(wrapper.vm.draft.titles).toBe(false);
});
