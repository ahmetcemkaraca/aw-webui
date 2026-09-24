import { createPinia, setActivePinia } from 'pinia';
import { useAIStore } from '~/stores/ai';

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock('~/util/awclient', () => ({
  getClient: () => ({ req: { get: mockGet, put: mockPut, post: mockPost, delete: mockDelete } }),
}));

describe('optional AI request controls', () => {
  let invoke: jest.Mock;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockGet.mockReset();
    mockPut.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
    invoke = jest.fn();
    (global as any).window = { __TAURI__: { core: { invoke } } };
  });

  afterEach(() => { delete (global as any).window; });

  test('keeps AI Off and makes no preview request until the user activates Custom Endpoint', async () => {
    const store = useAIStore();
    mockGet
      .mockResolvedValueOnce({ data: { schema_version: 1, revision: 0, mode: 'off', active_connection_id: null, profiles: [] } })
      .mockResolvedValueOnce({ data: { schema_version: 1, mode: 'off', custom_endpoint_available: false, peak_ai_available: false } });
    await store.refresh();
    await store.preview({ schema_version: 1, profile_id: 'profile_01', feature: 'report_explanation', question: 'Explain', aggregate: { days: [] } });

    expect(store.settings?.mode).toBe('off');
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('stores a credential only through the native command and never in Pinia state', async () => {
    const store = useAIStore();
    invoke.mockResolvedValue('cred-0123456789abcdef0123456789abcdef');

    const reference = await store.saveCredential('synthetic-bearer-secret');

    expect(reference).toBe('cred-0123456789abcdef0123456789abcdef');
    expect(invoke).toHaveBeenCalledWith('save_ai_credential', { secret: 'synthetic-bearer-secret' });
    expect(JSON.stringify(store.$state)).not.toContain('synthetic-bearer-secret');
  });

  test('previews, approves, and sends through native storage without returning credentials to the view', async () => {
    const store = useAIStore();
    const settings = {
      schema_version: 1,
      revision: 3,
      mode: 'custom_endpoint',
      active_connection_id: 'profile_01',
      profiles: [{ profile_id: 'profile_01', credential_ref: 'cred-opaque' }],
    };
    mockGet
      .mockResolvedValueOnce({ data: settings })
      .mockResolvedValueOnce({ data: { schema_version: 1, mode: 'custom_endpoint', custom_endpoint_available: true, peak_ai_available: false } });
    const preview = {
      profile_id: 'profile_01',
      origin: 'https://ai.example.invalid',
      model_id: 'synthetic-model',
      purpose_id: 'ai.custom_endpoint',
      retention_disclosure: 'Not verified',
      decision: { outcome: 'allow', preview_id: 'preview_01', sanitized_payload: { model: 'synthetic-model' }, removed_fields: [], reason_codes: [] },
    };
    mockPost
      .mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({ data: { approval_id: 'approval_01' } });
    invoke.mockResolvedValue({ source_mode: 'custom_endpoint', profile_label: 'My endpoint', model_id: 'synthetic-model', text: 'Synthetic explanation' });
    await store.refresh();

    await store.preview({ schema_version: 1, profile_id: 'profile_01', feature: 'report_explanation', question: 'Explain', aggregate: { days: [] } });
    await store.approve('profile_01', 'report_explanation');
    await store.send('profile_01', 'report_explanation');

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/0/ai/preview', expect.any(Object));
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/0/ai/approve', {
      profile_id: 'profile_01', preview_id: 'preview_01', scope: 'once', expires_at: null,
    });
    expect(invoke).toHaveBeenCalledWith('send_ai_request', {
      profileId: 'profile_01', credentialRef: 'cred-opaque', previewId: 'preview_01', approvalId: 'approval_01',
    });
    expect(store.result?.text).toBe('Synthetic explanation');
    expect(JSON.stringify(store.$state)).not.toContain('synthetic-bearer-secret');
  });

  test('stores only an explicitly saved result and supports individual deletion', async () => {
    const store = useAIStore();
    store.result = {
      schema_version: 1,
      source_mode: 'custom_endpoint',
      profile_label: 'My endpoint',
      model_id: 'synthetic-model',
      text: 'Synthetic explanation',
    };
    store.resultFeature = 'report_explanation';
    const saved = {
      schema_version: 1,
      revision: 1,
      insights: [{
        insight_id: 'insight_01',
        created_at: '2026-09-24T12:00:00Z',
        source_mode: 'custom_endpoint',
        profile_label: 'My endpoint',
        model_id: 'synthetic-model',
        feature: 'report_explanation',
        text: 'Synthetic explanation',
      }],
    };
    mockPost.mockResolvedValueOnce({ data: saved });

    expect(await store.saveResult('report_explanation')).toBe(true);
    expect(mockPost).toHaveBeenCalledWith('/api/0/ai/history', {
      feature: 'report_explanation', result: store.result,
    });
    expect(store.history).toEqual(saved.insights);
    expect(JSON.stringify(store.history)).not.toContain('aggregate');

    mockDelete.mockResolvedValueOnce({ data: { schema_version: 1, revision: 2, insights: [] } });
    await store.deleteInsight('insight_01');
    expect(mockDelete).toHaveBeenCalledWith('/api/0/ai/history/insight_01');
    expect(store.history).toEqual([]);
  });

  test('approval cannot be reused by another feature panel', async () => {
    const store = useAIStore();
    mockGet
      .mockResolvedValueOnce({ data: {
        schema_version: 1,
        revision: 3,
        mode: 'custom_endpoint',
        active_connection_id: 'profile_01',
        profiles: [{ profile_id: 'profile_01', credential_ref: 'cred-opaque' }],
      } })
      .mockResolvedValueOnce({ data: { schema_version: 1, mode: 'custom_endpoint', custom_endpoint_available: true, peak_ai_available: false } });
    mockPost.mockResolvedValueOnce({ data: {
      profile_id: 'profile_01',
      origin: 'https://ai.example.invalid',
      model_id: 'synthetic-model',
      purpose_id: 'ai.custom_endpoint',
      retention_disclosure: 'Not verified',
      decision: { outcome: 'allow', preview_id: 'preview_01', sanitized_payload: {}, removed_fields: [], reason_codes: [] },
    } });
    await store.refresh();
    await store.preview({ schema_version: 1, profile_id: 'profile_01', feature: 'report_explanation', question: 'Explain', aggregate: { days: [] } });

    expect(await store.approve('profile_01', 'category_suggestion')).toBe(false);
    expect(await store.send('profile_01', 'category_suggestion')).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('discards a preview response after its aggregate was cleared', async () => {
    const store = useAIStore();
    store.settings = { schema_version: 1, revision: 1, mode: 'custom_endpoint', active_connection_id: 'profile_01', profiles: [] };
    store.status = { schema_version: 1, mode: 'custom_endpoint', revision: 1, custom_endpoint_available: true, peak_ai_available: false, native_secret_store_available: true };
    let resolveRequest!: (response: { data: any }) => void;
    mockPost.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));

    const pending = store.preview({ schema_version: 1, profile_id: 'profile_01', feature: 'report_explanation', question: 'Explain', aggregate: { days: [] } });
    store.clearPreview();
    resolveRequest({ data: {
      profile_id: 'profile_01', origin: 'https://ai.example.invalid', model_id: 'synthetic-model', purpose_id: 'ai.custom_endpoint',
      retention_disclosure: 'Not verified', decision: { outcome: 'allow', preview_id: 'stale', sanitized_payload: {}, removed_fields: [], reason_codes: [] },
    } });

    expect(await pending).toBe(false);
    expect(store.preview).toBeNull();
    expect(store.busy).toBe(false);
  });
});
