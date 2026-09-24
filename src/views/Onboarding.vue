<template lang="pug">
main.container.py-4(aria-labelledby="setup-title")
  section.card.mx-auto(style="max-width: 56rem")
    .card-body
      p.small.text-muted(role="status") Step {{ step }} of 4
      h1#setup-title.h3 Welcome to PeakActivity
      ol.setup-steps(aria-label="Setup steps")
        li(:aria-current="step === 1 ? 'step' : null") Data sources
        li(:aria-current="step === 2 ? 'step' : null") Permissions
        li(:aria-current="step === 3 ? 'step' : null") AI and sync
        li(:aria-current="step === 4 ? 'step' : null") Ready

      section(v-if="step === 1" aria-labelledby="setup-sources-title")
        h2#setup-sources-title.h5 Choose data sources
        p PeakActivity works without an account, subscription, AI, sync, or internet. Recording stays off until you start it on the final step.
        p.small.text-muted Choose only the sources and fields you want stored. You can change these controls later in Privacy settings.
        capture-controls(
          :allow-start="false"
          @policy-dirty="policySaved = false"
          @policy-saved="policySaved = true"
        )
        p.small.text-muted Save the source and field choices before continuing.
        button.btn.btn-primary(type="button" :disabled="!policySaved || capture.busy" @click="next") Review permissions

      section(v-else-if="step === 2" aria-labelledby="setup-permissions-title")
        h2#setup-permissions-title.h5 Review permissions
        p PeakActivity cannot verify every operating-system permission. Review the settings for each enabled source; leave a source off if you do not grant its permission.
        ul.list-group.mb-3(v-if="selectedSources.length")
            li.list-group-item(v-for="source in selectedSources" :key="source.id")
              h3.h6 {{ source.name }}
              p.small.mb-2 {{ source.guidance }}
              label.d-block.mb-2
                input.mr-2(type="checkbox" v-model="disabledSources" :value="source.id")
                | Continue without this source
              button.btn.btn-sm.btn-outline-secondary(type="button" @click="openSystemSettings(source.id)") Open system settings
        p(v-else) No automatic data sources are selected. You can continue without recording.
        p.small.text-muted(v-if="systemSettingsMessage" role="status") {{ systemSettingsMessage }}
        button.btn.btn-outline-secondary.mr-2(type="button" @click="previous") Back
        button.btn.btn-primary(type="button" @click="continueWithFewerSources") Continue with fewer sources

      section(v-else-if="step === 3" aria-labelledby="setup-choices-title")
        h2#setup-choices-title.h5 AI and sync choices
        fieldset.mb-4
          legend.h6 AI mode
          p.small.text-muted Off means no AI endpoint request. PeakActivity does not download or run a model on this device.
          label.d-block(v-for="mode in experience.ai_modes" :key="mode.id")
            input.mr-2(type="radio" name="setup-ai-mode" :value="mode.id" v-model="aiMode" :disabled="!modeEnabled(mode)")
            | {{ mode.label }}
            small.ml-1.text-muted(v-if="mode.id !== 'off'") ({{ capabilityStatus(mode.id === 'peak-ai' ? 'peak-ai' : 'custom-endpoint') }})
        fieldset.mb-4
          legend.h6 Sync
          label.d-block
            input.mr-2(type="radio" name="setup-sync-mode" value="not-configured" v-model="syncMode")
            | Not configured
          label.d-block
            input.mr-2(type="radio" name="setup-sync-mode" value="sync" v-model="syncMode" :disabled="!isShipped('e2ee-sync')")
            | Set up sync
            small.ml-1.text-muted ({{ capabilityStatus('e2ee-sync') }})
          p.small.text-muted Sync is separate from AI and does not turn on automatically.
        button.btn.btn-outline-secondary.mr-2(type="button" @click="previous") Back
        button.btn.btn-primary(type="button" @click="next") Review setup

      section(v-else aria-labelledby="setup-ready-title")
        h2#setup-ready-title.h5 Ready on this device
        dl.row
          dt.col-sm-4 Local Vault
          dd.col-sm-8 Encrypted and stored on this device
          dt.col-sm-4 Data sources
          dd.col-sm-8 {{ sourceSummary }}
          dt.col-sm-4 Fields to store
          dd.col-sm-8 {{ fieldSummary }}
          dt.col-sm-4 Recording
          dd.col-sm-8 Recording off until you choose Start recording
          dt.col-sm-4 AI mode
          dd.col-sm-8 {{ aiLabel }}
          dt.col-sm-4 Sync
          dd.col-sm-8 Not configured
        p.small.text-muted Your local history, privacy controls, export, correction, and deletion remain available without an account or paid plan.
        button.btn.btn-outline-secondary.mr-2(type="button" @click="previous") Back
        button.btn.btn-outline-secondary.mr-2(type="button" :disabled="capture.busy" @click="finish(false)") Continue without recording
        button.btn.btn-primary(type="button" :disabled="!hasSources || capture.busy" @click="finish(true)") Start recording

      p.text-danger.mt-3(v-if="error" role="alert") {{ error }}
</template>

<script lang="ts">
import CaptureControls from '~/components/CaptureControls.vue';
import { useCaptureStore } from '~/stores/capture';
import experience from '~/generated/product-experience.json';
import { capability } from '~/product/experience';

const SOURCE_GUIDANCE = {
  window: {
    name: 'Applications and windows',
    guidance: 'Some systems require Accessibility or display access to read the active application. Window titles stay off unless you enable them.',
  },
  idle: {
    name: 'Active and idle status',
    guidance: 'This source records active or idle state, not keystroke content. Review your operating-system privacy settings before enabling it.',
  },
  browser: {
    name: 'Browser activity',
    guidance: 'Only supported browsers with an explicit private-window signal are included. If a browser cannot provide that signal, exclude it.',
  },
};

async function openPermissionSettings(source: string): Promise<boolean> {
  const bridge = (window as unknown as { __TAURI__?: { core: { invoke: (name: string, args?: object) => Promise<boolean> } } }).__TAURI__;
  if (!bridge) throw new Error('Open this permission control in PeakActivity desktop.');
  return bridge.core.invoke('open_permission_settings', { source });
}

export default {
  name: 'Onboarding',
  components: { CaptureControls },
  data() {
    return {
      step: 1,
      policySaved: false,
      disabledSources: [] as string[],
      aiMode: 'off',
      syncMode: 'not-configured',
      error: '',
      systemSettingsMessage: '',
      experience,
    };
  },
  computed: {
    capture() { return useCaptureStore(); },
    hasSources(): boolean {
      const policy = this.capture.policy;
      return !!policy && (policy.window || policy.idle || policy.browser);
    },
    selectedSources() {
      const policy = this.capture.policy;
      return (['window', 'idle', 'browser'] as const)
        .filter(id => policy?.[id])
        .map(id => ({ id, ...SOURCE_GUIDANCE[id] }));
    },
    sourceSummary(): string {
      const fields = this.capture.policy;
      if (!fields) return 'No sources selected';
      const names = this.selectedSources.map(source => source.name);
      return names.length ? names.join(', ') : 'No automatic sources selected';
    },
    fieldSummary(): string {
      const policy = this.capture.policy;
      if (!policy) return 'No fields selected';
      const fields = [];
      if (policy.window || policy.browser) fields.push('application names');
      if (policy.idle) fields.push('active and idle state');
      if (policy.titles) fields.push('window titles');
      if (policy.urls) fields.push('website origins');
      if (policy.paths) fields.push('file paths');
      return fields.length ? fields.join(', ') : 'None';
    },
    aiLabel(): string {
      return this.aiMode === 'off' ? 'Off' : 'Unavailable';
    },
  },
  methods: {
    capabilityStatus(id: string): string {
      return capability(id, experience)?.status || 'Unavailable';
    },
    isShipped(id: string): boolean {
      return ['Available', 'Beta', 'Experimental'].includes(this.capabilityStatus(id));
    },
    modeEnabled(mode: { id: string }): boolean {
      return mode.id === 'off' || this.isShipped(mode.id);
    },
    next() {
      if (this.step === 1 && !this.policySaved) {
        this.error = 'Save your data source and field choices before continuing.';
        return;
      }
      this.error = '';
      this.step = Math.min(4, this.step + 1);
    },
    previous() {
      this.error = '';
      this.step = Math.max(1, this.step - 1);
    },
    async continueWithFewerSources() {
      const policy = this.capture.policy;
      if (!policy) { this.next(); return; }
      const reduced = { ...policy };
      if (this.disabledSources.includes('window')) reduced.window = false;
      if (this.disabledSources.includes('idle')) reduced.idle = false;
      if (this.disabledSources.includes('browser')) reduced.browser = false;
      try {
        const saved = await this.capture.save({ ...reduced, recording: false, paused_until: null });
        if (saved) {
          this.policySaved = true;
          this.error = '';
          this.next();
        }
      } catch (_) { this.error = this.capture.error || 'The source changes could not be saved. Review recording status before continuing.'; }
    },
    async openSystemSettings(source: string) {
      this.systemSettingsMessage = '';
      try {
        const opened = await openPermissionSettings(source);
        if (!opened) this.systemSettingsMessage = 'This desktop environment has no standard settings link. Open its Privacy settings manually; PeakActivity has not verified permission status.';
      } catch (_) {
        this.systemSettingsMessage = 'System settings could not be opened. Review permissions manually; PeakActivity has not verified permission status.';
      }
    },
    async finish(recording: boolean) {
      const policy = this.capture.policy;
      if (!policy) { this.error = 'Recording settings are unavailable. Try again after the local vault loads.'; return; }
      if (recording && !this.hasSources) { this.error = 'Enable at least one data source before starting recording.'; return; }
      this.error = '';
      try {
        const saved = await this.capture.save({ ...policy, recording, paused_until: null });
        if (saved) this.$emit('complete');
      } catch (_) { this.error = this.capture.error || 'Setup could not be saved. Recording has not been started.'; }
    },
  },
};
</script>
