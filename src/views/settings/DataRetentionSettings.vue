<template lang="pug">
div
  h5 Raw event retention
  b-form-group(label="Automatically delete older local events")
    b-form-select(v-model.number="selectedDays" :options="displayOptions" :disabled="saving" @change="saveRetention")
  small.d-block.text-muted Cleanup runs within a minute after a policy change, then daily while PeakActivity is open. If it is closed, cleanup runs after the next launch.
  small.text-muted
    | Correction metadata for deleted events is removed with them. Report totals are calculated from retained events; no separate aggregate dataset is kept.
  b-alert.mt-2(v-if="error" show variant="danger") {{ error }}
  small.d-block.mt-2(v-if="saving" role="status") Saving retention policy…
  hr
  h5 Support bundle
  p.small.text-muted Preview the exact diagnostics before saving. Activity contents and log messages are excluded; only recent error/warning counts are included. Paths, tokens and keys are never included.
  b-button(variant="outline-secondary" :disabled="supportBusy" @click="previewBundle") Preview support bundle
  b-alert.mt-2(v-if="supportError" show variant="danger") {{ supportError }}
  b-alert.mt-2(v-if="supportSaved" show variant="success") Saved {{ supportSaved }}
  div.mt-2(v-if="supportPreview")
    pre.support-preview(v-text="supportPreview.content")
    b-button(variant="primary" :disabled="supportBusy" @click="saveBundle") {{ supportBusy ? 'Saving…' : 'Save this exact preview' }}
</template>

<script lang="ts">
import { registerPolicyDraft } from '~/util/policyDrafts';
import { useSettingsStore } from '~/stores/settings';

async function nativeInvoke(command: string, args?: object): Promise<unknown> {
  const bridge = (window as unknown as {
    __TAURI__?: { core: { invoke: (command: string, args?: object) => Promise<unknown> } };
  }).__TAURI__;
  if (!bridge) throw new Error('Open this control in PeakActivity desktop.');
  return bridge.core.invoke(command, args);
}

export default {
  name: 'DataRetentionSettings',
  data() {
    return {
      settingsStore: useSettingsStore(),
      selectedDays: 0,
      savedDays: 0,
      unregisterPolicyDraft: null,
      saving: false,
      error: '',
      supportPreview: null as { id: string; content: string } | null,
      supportBusy: false,
      supportError: '',
      supportSaved: '',
      options: [
        { value: 0, text: 'Never delete automatically' },
        { value: 30, text: '30 days' },
        { value: 90, text: '90 days' },
        { value: 180, text: '180 days' },
        { value: 365, text: '1 year' },
      ],
    };
  },
  computed: {
    displayOptions() { return this.options.some(option => option.value === this.selectedDays) ? this.options : [...this.options,{value:this.selectedDays,text:`${this.selectedDays} days`}]; },
  },
  async mounted() {
    this.unregisterPolicyDraft = registerPolicyDraft(['settings.rawRetentionDays'], {
      blocked: () => this.saving || this.selectedDays !== this.savedDays,
      reload: async owned => { if (await owned()) this.selectedDays = this.savedDays = this.settingsStore.rawRetentionDays ?? 0; },
    });
    await this.settingsStore.ensureLoaded();
    this.selectedDays = this.savedDays = this.settingsStore.rawRetentionDays ?? 0;
  },
  beforeDestroy() { this.unregisterPolicyDraft?.(); },
  watch: {
    'settingsStore.rawRetentionDays'(value) {
      if (!this.saving && this.selectedDays === this.savedDays) this.selectedDays = value ?? 0;
      if (!this.saving) this.savedDays = value ?? 0;
    },
  },
  methods: {
    async saveRetention(value: number) {
      const previous = this.settingsStore.rawRetentionDays || 0;
      this.saving = true;
      this.error = '';
      try {
        await this.settingsStore.update({ rawRetentionDays: value });
        this.savedDays = value;
      } catch (error) {
        this.settingsStore.$patch({ rawRetentionDays: previous });
        this.selectedDays = previous;
        this.error = error instanceof Error ? error.message : 'Retention could not be saved.';
      } finally {
        this.saving = false;
      }
    },
    async previewBundle() {
      this.supportBusy = true;
      this.supportError = '';
      this.supportSaved = '';
      try {
        this.supportPreview = await nativeInvoke('support_bundle_preview') as { id: string; content: string };
      } catch (error) {
        this.supportError = error instanceof Error ? error.message : 'Support preview could not be generated.';
      } finally {
        this.supportBusy = false;
      }
    },
    async saveBundle() {
      if (!this.supportPreview || this.supportBusy) return;
      this.supportBusy = true;
      this.supportError = '';
      try {
        const filename = await nativeInvoke('export_support_bundle', { previewId: this.supportPreview.id }) as string | null;
        if (filename) {
          this.supportSaved = filename;
          this.supportPreview = null;
        }
      } catch (error) {
        this.supportError = error instanceof Error ? error.message : 'Support bundle could not be saved.';
      } finally {
        this.supportBusy = false;
      }
    },
  },
};
</script>

<style scoped>
.support-preview {
  max-height: 24rem;
  overflow: auto;
  padding: 0.75rem;
  background: #f6f7f8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
