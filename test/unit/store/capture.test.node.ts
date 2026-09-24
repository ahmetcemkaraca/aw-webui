import { createPinia, setActivePinia } from 'pinia';
import { useCaptureStore } from '~/stores/capture';
import { getClient } from '~/util/awclient';

jest.mock('~/util/awclient', () => ({
  getClient: jest.fn(() => ({ req: { post: jest.fn() } })),
  clearLocalSession: jest.fn(),
}));

describe('recording state', () => {
  beforeEach(() => { setActivePinia(createPinia()); jest.clearAllMocks(); });

  test('does not claim healthy recording when a required helper is missing', () => {
    const store = useCaptureStore();
    store.policy = { recording: true } as any;
    store.recording = true;
    store.runtime = { expected: ['aw-watcher-window'], modules: {}, private_mode: false };
    expect(store.label).toContain('degraded');
    store.runtime.modules['aw-watcher-window'] = true;
    expect(store.label).toBe('Recording');
    store.error = 'No response';
    expect(store.label).toContain('unavailable');
  });

  test('distinguishes private mode and a scheduled pause from recording off', () => {
    const store = useCaptureStore();
    store.policy = { recording: false, paused_until: null } as any;
    store.runtime.private_mode = true;
    expect(store.label).toBe('Private Mode');
    store.runtime.private_mode = false;
    store.policy = { recording: true, paused_until: new Date(Date.now() + 60_000).toISOString() } as any;
    expect(store.label).toBe('Scheduled pause');
  });

  test('failed consent update does not commit optimistic state', async () => {
    const store = useCaptureStore();
    const previous = { recording: false, window: true, idle: true } as any;
    store.policy = previous;
    (getClient as jest.Mock).mockReturnValue({ req: { post: jest.fn().mockRejectedValue(new Error('offline')) } });
    await expect(store.save({ ...previous, recording: true })).rejects.toThrow();
    expect(store.policy).toEqual(previous);
    expect(store.recording).toBe(false);
    expect(store.error).not.toBe('');
  });

  test('panic pause wins over an older pending save response', async () => {
    const store = useCaptureStore();
    let finish;
    const saving = new Promise(resolve => { finish = resolve; });
    (getClient as jest.Mock).mockReturnValue({ req: { post: jest.fn(() => saving) } });
    const paused = { recording: false, revision: 3, paused_until: null } as any;
    (global as any).window = { __TAURI__: { core: { invoke: jest.fn().mockResolvedValue(paused) } } };
    try {
      const pending = store.save({ recording: true, revision: 1 } as any);
      await store.pause();
      finish({ data: { policy: { recording: true, revision: 2 }, recording: true } });
      expect(await pending).toBe(false);
      expect(store.policy).toEqual(paused);
      expect(store.recording).toBe(false);
    } finally { delete (global as any).window; }
  });
});
