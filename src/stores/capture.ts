import { defineStore } from 'pinia';
import { getClient, clearLocalSession } from '~/util/awclient';

export interface CapturePolicy {
  revision: number;
  recording: boolean;
  paused_until: string | null;
  window: boolean;
  idle: boolean;
  browser: boolean;
  titles: boolean;
  urls: boolean;
  paths: boolean;
  excluded_apps: string[];
  excluded_domains: string[];
  effective_from: string;
}

async function native(command: string, args?: object): Promise<unknown> {
  const bridge = (window as unknown as { __TAURI__?: { core: { invoke: (name: string, values?: object) => Promise<unknown> } } }).__TAURI__;
  if (!bridge) throw new Error('Open Privacy controls in PeakActivity desktop.');
  return bridge.core.invoke(command, args);
}

export const useCaptureStore = defineStore('capture', {
  state: () => ({
    policy: null as CapturePolicy | null,
    recording: false,
    runtime: { expected: [] as string[], modules: {} as Record<string, boolean | null>, private_mode: false },
    busy: false,
    pausing: false,
    error: '',
    generation: 0,
  }),
  getters: {
    label(state): string {
      if (state.error) return 'Recording status unavailable';
      if (state.busy) return 'Updating recording…';
      if (!state.policy) return 'Checking recording…';
      if (state.runtime.private_mode) return 'Private Mode';
      if (state.policy.paused_until && Date.parse(state.policy.paused_until) > Date.now()) return 'Scheduled pause';
      if (!state.recording) return state.policy.paused_until ? 'Recording paused' : 'Recording off';
      if (!state.runtime.expected.length || state.runtime.expected.some(name => state.runtime.modules[name] !== true)) {
        return 'Recording degraded — check data sources';
      }
      return 'Recording';
    },
  },
  actions: {
    async reloadPolicy(owned: () => Promise<boolean>): Promise<boolean> {
      if (this.busy || this.pausing) return false;
      const generation = ++this.generation;
      try {
        const response = await getClient().req.get('/0/capture/');
        if (generation !== this.generation || this.busy || this.pausing || !await owned() || generation !== this.generation || this.busy || this.pausing) return false;
        this.policy = response.data.policy;
        this.recording = response.data.recording === true;
        this.error = '';
        return true;
      } catch (_) { return false; }
    },
    async load() {
      if (this.busy) return;
      const generation = this.generation;
      try {
        const [response, runtime] = await Promise.all([getClient().req.get('/0/capture/'), native('capture_runtime')]);
        if (this.busy || generation !== this.generation) return;
        this.policy = response.data.policy;
        this.recording = response.data.recording;
        const runtimeState = runtime as typeof this.runtime;
        this.runtime = { ...this.runtime, ...runtimeState, private_mode: runtimeState.private_mode === true };
        this.error = '';
      } catch (_) {
        if (generation === this.generation) this.error = 'Cannot verify recording. Use Pause to stop local capture, then check the vault and data sources.';
      }
    },
    async save(policy: CapturePolicy) {
      if (this.pausing) return false;
      this.busy = true;
      const generation = ++this.generation;
      this.error = '';
      try {
        const response = await getClient().req.post('/0/capture/', policy);
        if (generation !== this.generation) return false;
        this.policy = response.data.policy;
        this.recording = response.data.recording;
        if (this.recording) this.runtime.private_mode = false;
        return true;
      } catch (error) {
        if (generation !== this.generation) return false;
        const message = error?.response?.data?.message;
        this.error = typeof message === 'string' ? message : 'The privacy change could not be saved. Review recording status before continuing.';
        throw new Error(this.error);
      } finally { if (generation === this.generation) this.busy = false; }
    },
    async pause() {
      return this.runNative('pause_capture');
    },
    async pauseFor(minutes: number) {
      return this.runNative('pause_capture_for', { minutes });
    },
    async pauseUntilTomorrow() {
      return this.runNative('pause_capture_until_tomorrow');
    },
    async enterPrivateMode() {
      return this.runNative('enter_private_mode');
    },
    async resume() {
      return this.runNative('resume_capture');
    },
    async runNative(command: string, args?: object) {
      if (this.pausing) return false;
      this.pausing = true;
      this.busy = true;
      const generation = ++this.generation;
      this.error = '';
      try {
        const policy = await native(command, args) as CapturePolicy;
        if (generation !== this.generation) return false;
        this.policy = policy;
        const now = Date.now();
        this.recording = policy.recording && Date.parse(policy.effective_from) <= now
          && (!policy.paused_until || Date.parse(policy.paused_until) <= now);
        const runtime = await native('capture_runtime') as typeof this.runtime;
        if (generation !== this.generation) return false;
        this.runtime = { ...this.runtime, ...runtime, private_mode: command === 'enter_private_mode' };
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Capture state could not be updated. Review recording status before continuing.';
        return false;
      } finally {
        clearLocalSession();
        if (generation === this.generation) { this.busy = false; this.pausing = false; }
      }
    },
  },
});
