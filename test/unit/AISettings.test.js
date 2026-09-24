import { shallowMount } from '@vue/test-utils';
import { useAIStore } from '~/stores/ai';
import AISettings from '~/views/settings/AISettings.vue';

jest.mock('~/stores/ai', () => ({ useAIStore: jest.fn() }));

describe('AI settings credential handling', () => {
  test('clears the bearer input before awaiting the native secret store', async () => {
    let resolveCredential;
    const store = {
      settings: { revision: 0, mode: 'off', active_connection_id: null, profiles: [] },
      status: { native_secret_store_available: true, custom_endpoint_available: false },
      history: [],
      credentialStatus: {},
      refresh: jest.fn().mockResolvedValue(undefined),
      loadHistory: jest.fn().mockResolvedValue(true),
      saveCredential: jest.fn(() => new Promise(resolve => { resolveCredential = resolve; })),
    };
    useAIStore.mockReturnValue(store);

    const wrapper = shallowMount(AISettings, {
      stubs: ['b-form-group', 'b-form-select', 'b-button', 'b-form-input', 'b-form-textarea'],
    });
    wrapper.vm.credentialInput = 'synthetic bearer secret';
    const saving = wrapper.vm.saveDraft();

    expect(store.saveCredential).toHaveBeenCalledWith('synthetic bearer secret');
    expect(wrapper.vm.credentialInput).toBe('');
    resolveCredential(null);
    await saving;
    wrapper.destroy();
  });
});
