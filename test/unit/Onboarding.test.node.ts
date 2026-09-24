/** @jest-environment jsdom */

import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useCaptureStore } from '~/stores/capture';
import Onboarding from '~/views/Onboarding.vue';

const policy = {
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
  effective_from: '2026-09-23T00:00:00Z',
};

function mountOnboarding() {
  setActivePinia(createPinia());
  const capture = useCaptureStore();
  capture.policy = policy as any;
  jest.spyOn(capture, 'save').mockResolvedValue(true);
  const wrapper = shallowMount(Onboarding, { stubs: ['CaptureControls'] });
  return { wrapper, capture };
}

describe('first-run onboarding', () => {
  test('keeps recording off until the final summary step', async () => {
    const { wrapper } = mountOnboarding();
    expect(wrapper.text()).toContain('Choose data sources');
    expect(wrapper.text()).not.toContain('Start recording');
    await wrapper.setData({ policySaved: true });
    await wrapper.find('button').trigger('click');
    await wrapper.findAll('button').at(-1).trigger('click');
    await wrapper.findAll('button').at(-1).trigger('click');
    expect(wrapper.text()).toContain('Start recording');
  });

  test('offers only Off as active AI and leaves sync unconfigured', async () => {
    const { wrapper } = mountOnboarding();
    await wrapper.setData({ policySaved: true });
    await wrapper.findAll('button').at(-1).trigger('click');
    await wrapper.findAll('button').at(-1).trigger('click');
    expect(wrapper.text()).toContain('Off');
    expect(wrapper.text()).toContain('Peak AI');
    expect(wrapper.text()).toContain('Custom Endpoint');
    expect(wrapper.text()).toContain('Not configured');
    expect(wrapper.text()).toContain('Planned');
  });

  test('reviews permissions separately for each enabled source', async () => {
    const { wrapper } = mountOnboarding();
    wrapper.vm.step = 2;
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Applications and windows');
    expect(wrapper.text()).toContain('Active and idle status');
    expect(wrapper.findAll('button').wrappers.filter(button => button.text().includes('Open system settings'))).toHaveLength(2);
    expect(wrapper.find('main[aria-labelledby="setup-title"]').exists()).toBe(true);
  });

  test('continue without recording persists the choice and completes setup', async () => {
    const { wrapper, capture } = mountOnboarding();
    wrapper.vm.step = 4;
    await wrapper.vm.$nextTick();
    const continueWithoutRecording = wrapper.findAll('button').wrappers.find(button => button.text().includes('Continue without recording'));
    await continueWithoutRecording.trigger('click');
    expect(capture.save).toHaveBeenCalledWith({ ...policy, recording: false, paused_until: null });
    expect(wrapper.emitted('complete')).toBeTruthy();
  });
});
