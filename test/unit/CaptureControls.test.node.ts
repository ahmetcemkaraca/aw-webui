/** @jest-environment jsdom */
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CaptureControls from '~/components/CaptureControls.vue';
import { useCaptureStore } from '~/stores/capture';

describe('recording controls', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('keeps the fail-safe pause available when recording status cannot be verified', async () => {
    const capture = useCaptureStore();
    capture.policy = { revision:1, recording:false, paused_until:null, window:true,idle:true,browser:false,titles:false,urls:false,paths:false,excluded_apps:[],excluded_domains:[],effective_from:'2026-10-14T00:00:00Z' };
    capture.recording = false;
    capture.error = 'Cannot verify recording';
    jest.spyOn(capture, 'load').mockResolvedValue(undefined);
    const wrapper = shallowMount(CaptureControls, { propsData: { compact: false } });
    await wrapper.vm.$nextTick();
    const pause = wrapper.findAll('button').wrappers.find(button => button.text() === 'Pause recording');
    const start = wrapper.findAll('button').wrappers.find(button => button.text() === 'Start recording');
    expect(pause.exists()).toBe(true);
    expect(start.attributes('disabled')).toBeDefined();
    wrapper.destroy();
  });
});
