jest.mock('aw-client', () => ({
  AWClient: jest.fn().mockImplementation(() => ({
    req: {
      defaults: { headers: { common: {} } },
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    },
  })),
}));

describe('native local session bootstrap', () => {
  let api;
  beforeEach(async () => {
    jest.resetModules();
    api = await import('~/util/awclient');
    sessionStorage.clear();
    delete window.__TAURI__;
    delete window.Android;
    window.history.replaceState({}, '', '/');
  });

  test('URL and stored credentials are discarded, never accepted', async () => {
    window.history.replaceState({}, '', '/?token=secret&foo=bar');
    sessionStorage.setItem('aw-api-token', 'stored-secret');
    api.discardLegacyUrlToken();
    expect(window.location.search).toBe('?foo=bar');
    expect(sessionStorage.getItem('aw-api-token')).toBeNull();
    await expect(api.authorizeLocalSession()).rejects.toThrow('PeakActivity');
  });

  test('concurrent requests share one native authorization and keep the token in memory', async () => {
    const invoke = jest.fn().mockResolvedValue('a'.repeat(64));
    window.__TAURI__ = { core: { invoke } };
    const values = await Promise.all([api.authorizeLocalSession(), api.authorizeLocalSession()]);
    expect(values).toEqual(['a'.repeat(64), 'a'.repeat(64)]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
    api.clearLocalSession();
    await api.authorizeLocalSession();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test('Android WebView bridge mints a validated in-memory local session', async () => {
    const android = { postMessage: jest.fn(), onmessage: null };
    android.postMessage.mockImplementation(payload => {
      const request = JSON.parse(payload);
      android.onmessage({ data: JSON.stringify({ id: request.id, result: 'b'.repeat(64) }) });
    });
    window.Android = android;
    await expect(api.authorizeLocalSession()).resolves.toBe('b'.repeat(64));
    expect(JSON.parse(android.postMessage.mock.calls[0][0])).toMatchObject({ command: 'local_session' });
    expect(sessionStorage.length).toBe(0);
  });

  test('Android bridge rejects malformed session credentials', async () => {
    const android = { postMessage: jest.fn(), onmessage: null };
    android.postMessage.mockImplementation(payload => {
      const request = JSON.parse(payload);
      android.onmessage({ data: JSON.stringify({ id: request.id, result: 'not-a-token' }) });
    });
    window.Android = android;
    await expect(api.authorizeLocalSession()).rejects.toThrow('local session');
  });

  test('Android native RPC resolves concurrent replies by request ID', async () => {
    const android = { postMessage: jest.fn(), onmessage: null };
    window.Android = android;
    const first = api.invokeAndroidNative('first');
    const second = api.invokeAndroidNative('second');
    const requests = android.postMessage.mock.calls.map(([value]) => JSON.parse(value));
    android.onmessage({ data: JSON.stringify({ id: requests[1].id, result: 'second-result' }) });
    android.onmessage({ data: JSON.stringify({ id: requests[0].id, result: 'first-result' }) });
    await expect(Promise.all([first, second])).resolves.toEqual(['first-result', 'second-result']);
  });

  test('development API origins are restricted to exact loopback HTTP origins', () => {
    expect(api.isLoopbackApiUrl('http://127.0.0.1:5666')).toBe(true);
    expect(api.isLoopbackApiUrl('http://localhost:8080/')).toBe(true);
    expect(api.isLoopbackApiUrl('http://[::1]:5666')).toBe(true);
    expect(api.isLoopbackApiUrl('https://127.0.0.1:5666')).toBe(false);
    expect(api.isLoopbackApiUrl('http://example.test:5666')).toBe(false);
    expect(api.isLoopbackApiUrl('http://user@localhost:5666')).toBe(false);
    expect(api.isLoopbackApiUrl('http://localhost:5666/proxy')).toBe(false);
  });
});
