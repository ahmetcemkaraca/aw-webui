import { AWClient } from 'aw-client';
import { AxiosHeaders } from 'axios';

import { useSettingsStore } from '~/stores/settings';

let _client: AWClient | null;
let sessionToken: string | null = null;
let pendingSession: Promise<string> | null = null;

type AndroidSessionBridge = {
  postMessage(message: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

type AndroidRpcReply = { id?: string; result?: unknown; error?: string };

const pendingAndroidCalls = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();
let androidCallId = 0;
let routedAndroidBridge: AndroidSessionBridge | null = null;

export function invokeAndroidNative(command: string, args?: object): Promise<unknown> {
  const android = (window as unknown as { Android?: AndroidSessionBridge }).Android;
  if (!android) return Promise.reject(new Error('Android native bridge is unavailable.'));
  if (routedAndroidBridge !== android) {
    const previous = android.onmessage;
    android.onmessage = event => {
      let reply: AndroidRpcReply | null = null;
      try { reply = JSON.parse(String(event.data)) as AndroidRpcReply; } catch (_) { /* not an RPC reply */ }
      const pending = reply?.id ? pendingAndroidCalls.get(reply.id) : undefined;
      if (!pending || !reply?.id) {
        previous?.(event);
        return;
      }
      pendingAndroidCalls.delete(reply.id);
      window.clearTimeout(pending.timeout);
      if (typeof reply.error === 'string') pending.reject(new Error(reply.error));
      else pending.resolve(reply.result);
    };
    routedAndroidBridge = android;
  }

  const id = `android-${++androidCallId}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingAndroidCalls.delete(id);
      reject(new Error('Android native operation timed out.'));
    }, 30_000);
    pendingAndroidCalls.set(id, { resolve, reject, timeout });
    try {
      android.postMessage(JSON.stringify({ id, command, args: args || {} }));
    } catch (error) {
      pendingAndroidCalls.delete(id);
      window.clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export async function authorizeLocalSession(): Promise<string> {
  if (sessionToken) return sessionToken;
  if (pendingSession) return pendingSession;
  const bridge = (window as unknown as {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
  }).__TAURI__;
  const android = (window as unknown as { Android?: AndroidSessionBridge }).Android;
  const authorization = android
    ? invokeAndroidNative('local_session')
    : bridge
      ? bridge.core.invoke('local_session')
      : Promise.reject(new Error('Open PeakActivity to authorize this view.'));
  pendingSession = authorization.then(value => {
    if (!validToken(value)) throw new Error('The local session could not be authorized.');
    sessionToken = value;
    return value;
  }).finally(() => { pendingSession = null; });
  return pendingSession;
}

export function clearLocalSession(): void {
  sessionToken = null;
}

export function isLoopbackApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1'].includes(host)
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch (_) {
    return false;
  }
}

export function discardLegacyUrlToken(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const hadToken = ['token', 'api_key', 'access_token'].some(key => url.searchParams.has(key));
  for (const key of ['token', 'api_key', 'access_token']) url.searchParams.delete(key);
  if (hadToken) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  // Never restore bearer credentials from storage or URLs.
  window.sessionStorage.removeItem('aw-api-token');
}

export function createClient(force?: boolean): AWClient {
  let baseURL = '';

  const production = typeof PRODUCTION !== 'undefined' && PRODUCTION;

  // If running with `npm node dev`, use testing server as origin.
  // Works since CORS is enabled by default when running `aw-server --testing`.
  if (!production) {
    const aw_server_url = typeof AW_SERVER_URL !== 'undefined' && AW_SERVER_URL;
    if (aw_server_url && !isLoopbackApiUrl(aw_server_url)) {
      throw new Error('AW_SERVER_URL must use an exact loopback HTTP origin.');
    }
    baseURL = aw_server_url ? new URL(aw_server_url).origin : 'http://127.0.0.1:5666';
  }

  if (!_client || force) {
    _client = new AWClient('aw-webui', {
      testing: !production,
      baseURL,
    });
    discardLegacyUrlToken();
    _client.req.interceptors.request.use(async config => {
      const token = await authorizeLocalSession();
      config.headers = AxiosHeaders.from(config.headers);
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    _client.req.interceptors.response.use(response => {
      const replacement = response.headers['x-peakactivity-token'];
      if (validToken(replacement)) sessionToken = replacement;
      return response;
    }, error => {
      // Do not replay writes; the next explicit request acquires a fresh IPC session.
      if (error.response?.status === 401) clearLocalSession();
      return Promise.reject(error);
    });
  } else {
    throw 'Tried to instantiate global AWClient twice!';
  }
  return _client;
}

export function configureClient(): void {
  const settings = useSettingsStore();
  _client.req.defaults.timeout = 1000 * settings.requestTimeout;
}

export function getClient(): AWClient {
  if (!_client) {
    throw 'Tried to get global AWClient before instantiating it!';
  }
  return _client;
}
