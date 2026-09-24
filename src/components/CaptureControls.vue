<template lang="pug">
section(:class="compact ? 'container py-2 border-bottom' : ''" aria-label="Recording and privacy")
  div.d-flex.flex-wrap.align-items-center
    strong.mr-3(role="status" aria-live="polite") {{ capture.label }}
    button.btn.btn-sm.btn-outline-danger.mr-2(v-if="capture.recording || capture.error" type="button" :disabled="capture.pausing" @click="capture.pause()") Pause recording
    button.btn.btn-sm.btn-outline-primary.mr-2(v-if="allowStart && capture.policy && !capture.recording && !capture.runtime.private_mode && !capture.policy.paused_until" type="button" :disabled="capture.busy || !!capture.error" @click="start") Start recording
    button.btn.btn-sm.btn-outline-primary.mr-2(v-if="allowStart && capture.policy && !capture.recording && (capture.runtime.private_mode || capture.policy.paused_until)" type="button" :disabled="capture.busy || !!capture.error" @click="start") Resume recording
    button.btn.btn-sm.btn-outline-dark.mr-2(v-if="allowStart && capture.recording" type="button" :disabled="capture.busy || !!capture.error" @click="capture.enterPrivateMode()") Enter Private Mode
    details.mr-2(v-if="allowStart && capture.recording")
      summary Pause temporarily
      div.d-flex.flex-wrap.pt-2
        button.btn.btn-sm.btn-outline-secondary.mr-2(type="button" :disabled="capture.busy || !!capture.error" @click="capture.pauseFor(15)") Pause for 15 minutes
        button.btn.btn-sm.btn-outline-secondary.mr-2(type="button" :disabled="capture.busy || !!capture.error" @click="capture.pauseFor(60)") Pause for 1 hour
        button.btn.btn-sm.btn-outline-secondary(type="button" :disabled="capture.busy || !!capture.error" @click="capture.pauseUntilTomorrow()") Pause until tomorrow
    button.btn.btn-sm.btn-outline-warning.mr-2(v-if="capture.recording && capture.label.includes('degraded')" type="button" :disabled="capture.busy || !!capture.error" @click="restart") Retry data sources
    router-link(v-if="compact" to="/settings/privacy") Review data sources
  p.small.text-muted.mb-1(v-if="capture.policy") {{ fieldSummary }}
  p.small.text-muted.mb-1(v-if="capture.runtime.private_mode") Private Mode pauses all automatic sources until you choose Resume recording.
  p.small.text-danger(role="alert" v-if="capture.error") {{ capture.error }}

  form.mt-3(v-if="!compact && draft" @submit.prevent="save" @input="$emit('policy-dirty')")
    h5 Data sources
    label.d-block #[input.mr-2(type="checkbox" v-model="draft.window")] Applications and windows
    label.d-block #[input.mr-2(type="checkbox" v-model="draft.idle")] Active and idle status
    label.d-block #[input.mr-2(type="checkbox" v-model="draft.browser")] Browser activity with a verified private-window signal
    p.small.text-muted Known browser activity is excluded without an explicit private-window signal. Unrecognized applications may not provide that signal; exclude them if needed. Enabling this option does not add platform support.
    h5.mt-3 Fields to store
    label.d-block #[input.mr-2(type="checkbox" v-model="draft.titles")] Window titles
    label.d-block #[input.mr-2(type="checkbox" v-model="draft.urls")] Website origins only (no path, query, fragment or credentials)
    label.d-block #[input.mr-2(type="checkbox" v-model="draft.paths")] File paths supplied by an enabled source
    label.d-block.mt-3(for="capture-excluded-apps") Excluded applications — one name fragment per line
    textarea#capture-excluded-apps.form-control(v-model="apps" rows="3" :disabled="capture.busy")
    div.mt-2
      button.btn.btn-sm.btn-outline-secondary.mr-2(type="button" @click="preset('passwords')" :disabled="capture.busy") Add password-manager exclusions
      button.btn.btn-sm.btn-outline-secondary(type="button" @click="preset('sensitive')" :disabled="capture.busy") Add banking and health exclusions
    p.small.text-muted Presets match application-name fragments. Review the list and add your own apps and domains before saving.
    label.d-block.mt-3(for="capture-excluded-domains") Excluded domains — one hostname per line, including subdomains
    textarea#capture-excluded-domains.form-control(v-model="domains" rows="3" :disabled="capture.busy")
    label.d-block.mt-3(for="capture-pause-until") Pause until (your local time)
    input#capture-pause-until.form-control(type="datetime-local" v-model="pauseUntil" :disabled="capture.busy")
    p.small.text-muted Saving a pause time enables automatic resume at that time. Clearing it cancels the schedule. Privacy controls never require an account or paid plan.
    button.btn.btn-primary.mt-2(type="submit" :disabled="capture.busy") Save privacy controls
    button.btn.btn-outline-secondary.mt-2.ml-2(type="button" :disabled="capture.busy" @click="reset") Reload saved controls
    p.small.text-success.mt-2(v-if="saved" role="status") Privacy controls saved.
</template>

<script lang="ts">
import { useCaptureStore } from '~/stores/capture';

export default {
  name: 'CaptureControls',
  props: {
    compact: { type: Boolean, default: false },
    allowStart: { type: Boolean, default: true },
  },
  data() {
    return { capture: useCaptureStore(), draft: null, apps: '', domains: '', pauseUntil: '', saved: false, timer: null };
  },
  computed: {
    fieldSummary(): string {
      const p = this.capture.policy;
      const fields = [];
      if (p.window || p.browser) fields.push('application names');
      if (p.idle) fields.push('idle status');
      if (p.titles) fields.push('window titles');
      if (p.urls) fields.push('website origins');
      if (p.paths) fields.push('file paths');
      return `Allowed fields: ${fields.length ? fields.join(', ') : 'none'}. Only enabled sources can record them.`;
    },
  },
  watch: {
    'capture.policy'(value) { if (value && !this.draft) this.reset(); },
  },
  async mounted() {
    await this.capture.load();
    this.reset();
    if (this.compact) this.timer = setInterval(() => this.capture.load(), 1000);
  },
  beforeDestroy() { if (this.timer) clearInterval(this.timer); },
  methods: {
    preset(name: string) {
      const values = name === 'passwords' ? ['1password', 'bitwarden', 'keepass', 'keychain', 'credential', 'password']
        : ['bank', 'health', 'medical', 'clinic', 'patient'];
      this.apps = Array.from(new Set([...this.apps.split('\n').map(value => value.trim()).filter(Boolean), ...values])).join('\n');
      this.saved = false;
      this.$emit('policy-dirty');
    },
    async restart() {
      await this.capture.pause();
      if (!this.capture.error) {
        try { await this.capture.save({ ...this.capture.policy, recording: true, paused_until: null }); }
        catch (_) { /* Visible store error. */ }
      }
    },
    reset() {
      if (!this.capture.policy) return;
      this.draft = { ...this.capture.policy };
      this.apps = this.draft.excluded_apps.join('\n');
      this.domains = this.draft.excluded_domains.join('\n');
      this.pauseUntil = '';
      if (this.draft.paused_until) {
        const date = new Date(this.draft.paused_until);
        this.pauseUntil = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
    },
    async start() {
      if (this.capture.runtime.private_mode || this.capture.policy.paused_until) {
        await this.capture.resume();
        return;
      }
      let policy;
      try { policy = this.compact ? this.capture.policy : this.formPolicy(); }
      catch (_) { this.capture.error = 'Enter a valid pause time.'; return; }
      if (!policy.window && !policy.idle && !policy.browser) {
        this.capture.error = 'Enable a data source in Privacy settings before starting recording.';
        return;
      }
      try {
        await this.capture.save({ ...policy, recording: true, paused_until: null });
        if (!this.compact) this.reset();
      } catch (_) { /* Visible store error. */ }
    },
    formPolicy() {
      const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
      const paused_until = this.pauseUntil ? new Date(this.pauseUntil).toISOString() : null;
      return { ...this.draft, recording: paused_until ? true : this.capture.policy.recording,
        excluded_apps: lines(this.apps), excluded_domains: lines(this.domains), paused_until };
    },
    async save() {
      this.saved = false;
      try {
        const applied = await this.capture.save(this.formPolicy());
        if (!applied) return;
        this.reset();
        this.saved = true;
        this.$emit('policy-saved', this.capture.policy);
      } catch (_) { if (!this.capture.error) this.capture.error = 'Enter a valid pause time.'; }
    },
  },
};
</script>
