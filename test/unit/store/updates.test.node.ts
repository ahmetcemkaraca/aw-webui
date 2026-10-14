import { createPinia, setActivePinia } from 'pinia';
import { useUpdatesStore } from '~/stores/updates';

const status = (state = 'ready') => ({
  schema_version: 1, state, installed_version: '2.0.0', platform: 'linux', native_architecture: 'x86_64',
});
const verified = () => ({
  schema_version: 1, version: '1.2.3+recovery', channel: 'stable', support_status: 'limited',
  platform: 'linux', native_architecture: 'x86_64', artifact_architecture: 'x86_64',
  source_revision: 'a'.repeat(40), manifest_fingerprint: 'B'.repeat(40), artifact_fingerprint: 'C'.repeat(64),
  local_integrity: 'verified', public_readback: 'not-checked', platform_signature: 'not-checked',
  release_freshness: 'not-checked', key_lifecycle: 'not-checked',
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('native offline release integrity', () => {
  let invoke: jest.Mock;
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = jest.fn();
    (global as any).window = { __TAURI__: { core: { invoke } } };
  });
  afterEach(() => { delete (global as any).window; });

  test('verifies an older bundle using only no-argument native commands', async () => {
    invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce(verified());
    const store = useUpdatesStore();
    await store.refreshStatus();
    await store.verifyBundle();
    expect(invoke.mock.calls).toEqual([['update_integrity_status'], ['verify_update_bundle']]);
    expect(store.status).toEqual(status());
    expect(store.result).toEqual(verified());
    expect(store.error).toBe('');
  });

  test.each(['not-configured', 'unavailable'])('%s resources never open a bundle', async state => {
    invoke.mockResolvedValue(status(state));
    const store = useUpdatesStore();
    await store.refreshStatus();
    await store.verifyBundle();
    expect(store.status.state).toBe(state);
    expect(invoke.mock.calls).toEqual([['update_integrity_status']]);
  });

  test.each([
    ['unknown fields', { ...status(), private_path: '/private/activity' }],
    ['missing fields', { schema_version: 1, state: 'ready' }],
    ['schema', { ...status(), schema_version: 2 }],
    ['state', { ...status(), state: 'signed' }],
    ['tuple', Object.values(status())],
    ['version', { ...status(), installed_version: 'PRIVATE_ACTIVITY' }],
    ['version newline', { ...status(), installed_version: '1.2.3\n' }],
    ['version size', { ...status(), installed_version: '1.2.3+' + 'a'.repeat(64000) }],
    ['platform', { ...status(), platform: 'android' }],
    ['architecture', { ...status(), native_architecture: 'universal' }],
  ])('rejects malformed status %s privately', async (_name, value) => {
    invoke.mockResolvedValue(value);
    const store = useUpdatesStore();
    await store.refreshStatus();
    expect(store.status).toBeNull();
    expect(store.result).toBeNull();
    expect(store.error).toBe('Release verification status could not be loaded. Try again.');
    expect(JSON.stringify(store.$state)).not.toMatch(/PRIVATE_ACTIVITY|\/private\/activity/);
  });

  test.each([
    ['unknown fields', { ...verified(), url: 'https://private.example/activity' }],
    ['tuple', Object.values(verified())],
    ['schema', { ...verified(), schema_version: 2 }],
    ['missing field', { ...verified(), artifact_fingerprint: undefined }],
    ['version', { ...verified(), version: 'PRIVATE_ACTIVITY' }],
    ['version newline', { ...verified(), version: '1.2.3\n' }],
    ['version size', { ...verified(), version: '1.2.3+' + 'a'.repeat(64000) }],
    ['channel', { ...verified(), channel: 'nightly' }],
    ['support', { ...verified(), support_status: 'safe-to-install' }],
    ['target platform', { ...verified(), platform: 'windows' }],
    ['target architecture', { ...verified(), native_architecture: 'arm64' }],
    ['artifact architecture', { ...verified(), artifact_architecture: 'arm64' }],
    ['Linux universal', { ...verified(), artifact_architecture: 'universal' }],
    ['revision case', { ...verified(), source_revision: 'A'.repeat(40) }],
    ['revision length', { ...verified(), source_revision: 'a'.repeat(41) }],
    ['revision newline', { ...verified(), source_revision: 'a'.repeat(40) + '\n' }],
    ['manifest fingerprint', { ...verified(), manifest_fingerprint: 'g'.repeat(40) }],
    ['artifact fingerprint', { ...verified(), artifact_fingerprint: 'C'.repeat(41) }],
    ['manifest fingerprint newline', { ...verified(), manifest_fingerprint: 'B'.repeat(40) + '\n' }],
    ['artifact fingerprint newline', { ...verified(), artifact_fingerprint: 'C'.repeat(40) + '\n' }],
    ['integrity', { ...verified(), local_integrity: 'unverified' }],
    ['readback claim', { ...verified(), public_readback: 'verified' }],
    ['platform signature claim', { ...verified(), platform_signature: 'verified' }],
    ['freshness claim', { ...verified(), release_freshness: 'verified' }],
    ['lifecycle claim', { ...verified(), key_lifecycle: 'verified' }],
  ])('rejects malformed bundle result %s privately', async (_name, value) => {
    invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce(value);
    const store = useUpdatesStore();
    await store.refreshStatus();
    await store.verifyBundle();
    expect(store.result).toBeNull();
    expect(store.error).toBe('The local release bundle could not be verified. Check the bundle and try again.');
    expect(JSON.stringify(store.$state)).not.toMatch(/PRIVATE_ACTIVITY|private\.example/);
  });

  test('allows beta metadata and an explicit macOS universal artifact', async () => {
    const native = { ...status(), platform: 'macos', native_architecture: 'arm64' };
    const bundle = { ...verified(), version: '1.2.3-beta.1', channel: 'beta', platform: 'macos',
      native_architecture: 'arm64', artifact_architecture: 'universal', source_revision: 'b'.repeat(64) };
    invoke.mockResolvedValueOnce(native).mockResolvedValueOnce(bundle);
    const store = useUpdatesStore();
    await store.refreshStatus();
    await store.verifyBundle();
    expect(store.result).toEqual(bundle);
  });

  test('clears an old result before a retry and treats null as cancellation', async () => {
    const pending = deferred();
    invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce(verified()).mockReturnValueOnce(pending.promise);
    const store = useUpdatesStore();
    await store.refreshStatus();
    await store.verifyBundle();
    const retry = store.verifyBundle();
    expect(store.result).toBeNull();
    expect(store.loading).toBe(true);
    pending.resolve(null);
    await retry;
    expect(store.cancelled).toBe(true);
    expect(store.error).toBe('');
    expect(store.result).toBeNull();
    expect(store.loading).toBe(false);
  });

  test('duplicate verify clicks do not create a second native dialog', async () => {
    const pending = deferred();
    invoke.mockResolvedValueOnce(status()).mockReturnValueOnce(pending.promise);
    const store = useUpdatesStore();
    await store.refreshStatus();
    const first = store.verifyBundle();
    await store.verifyBundle();
    expect(invoke.mock.calls).toEqual([['update_integrity_status'], ['verify_update_bundle']]);
    pending.resolve(verified());
    await first;
  });

  test('an invalidated status read cannot overwrite a newer response', async () => {
    const pending = deferred();
    invoke.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(status('not-configured'));
    const store = useUpdatesStore();
    const first = store.refreshStatus();
    store.clearSensitive();
    await store.refreshStatus();
    pending.resolve(status());
    await first;
    expect(store.status.state).toBe('not-configured');
    expect(store.loading).toBe(false);
  });

  test.each(['clearSensitive', '$dispose'])('%s clears metadata and ignores late success', async action => {
    const pending = deferred();
    invoke.mockResolvedValueOnce(status()).mockReturnValueOnce(pending.promise);
    const store = useUpdatesStore();
    await store.refreshStatus();
    const checking = store.verifyBundle();
    store[action]();
    pending.resolve(verified());
    await checking;
    expect(store.result).toBeNull();
    expect(store.status).toBeNull();
    expect(store.error).toBe('');
    expect(store.loading).toBe(false);
  });

  test('disposal ignores late errors and prevents a disposed reference from invoking again', async () => {
    const pending = deferred();
    invoke.mockReturnValueOnce(pending.promise);
    const store = useUpdatesStore();
    const reading = store.refreshStatus();
    store.$dispose();
    pending.reject(new Error('/private/path SECRET_TOKEN'));
    await reading;
    await store.refreshStatus();
    await store.verifyBundle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(store.error).toBe('');
    invoke.mockResolvedValue(status());
    const remounted = useUpdatesStore();
    await remounted.refreshStatus();
    expect(remounted.status.state).toBe('ready');
  });

  test('shows native absence and private native failures using fixed copy', async () => {
    delete (global as any).window;
    const store = useUpdatesStore();
    await store.refreshStatus();
    expect(store.error).toBe('Open Updates in PeakActivity desktop.');
    expect(store.nativeAvailable).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('keeps private native verification errors out of UI state', async () => {
    invoke.mockResolvedValueOnce(status()).mockRejectedValueOnce(new Error('/private/path SECRET_TOKEN'));
    const store = useUpdatesStore();
    await store.refreshStatus();
    await store.verifyBundle();
    expect(store.result).toBeNull();
    expect(store.error).toBe('The local release bundle could not be verified. Check the bundle and try again.');
    expect(JSON.stringify(store.$state)).not.toMatch(/SECRET_TOKEN|\/private\/path/);
    expect(store.loading).toBe(false);
  });
});
