import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CaptureControls from '~/components/CaptureControls.vue';
import { useCaptureStore } from '~/stores/capture';

describe('recording controls', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('keeps the fail-safe pause available when recording status cannot be verified', async () => {
    const capture = useCaptureStore();
    capture.policy = { recording: false, paused_until: null } as any;
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
