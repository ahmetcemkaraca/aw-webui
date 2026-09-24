<template lang="pug">
section(aria-labelledby="ai-settings-title")
  h5#ai-settings-title Optional AI services
  p(role="status" aria-live="polite")
    | AI mode: {{ modeLabel }}. No model request is sent while Off.
  p.small.text-muted Peak AI is unavailable until a signed provider registry, provider contract and credit controls are approved.
  p.small.text-muted(v-if="status && !status.custom_endpoint_available" role="status") Custom Endpoint is unavailable until this platform has a native secret store, the kill switch is off and a signed AI Egress purpose is installed.
  p.text-danger(role="alert" v-if="store.error") {{ store.error }}

  section.mt-3(aria-labelledby="ai-mode-title")
    h6#ai-mode-title AI mode
    label.d-block
      input.mr-2(type="radio" name="ai-mode" value="off" :checked="settings.mode === 'off'" @change="turnOff" :disabled="store.busy")
      | Off — no model request or automatic fallback
    label.d-block
      input.mr-2(type="radio" name="ai-mode" value="peak_ai" disabled)
      | Peak AI — unavailable
    label.d-block
      input.mr-2(type="radio" name="ai-mode" value="custom_endpoint" disabled)
      | Custom Endpoint — enable from a tested saved profile below
    b-form-group.mt-2(label="Active endpoint profile" label-for="ai-active-profile")
      b-form-select#ai-active-profile(v-model="selectedProfileId" :options="profileOptions" :disabled="!canActivate || store.busy")
    b-button(variant="primary" type="button" @click="activateSelected" :disabled="!canActivate || store.busy || !selectedProfileId") Activate Custom Endpoint

  section.mt-4(aria-labelledby="ai-endpoints-title")
    h6#ai-endpoints-title Custom Endpoint profiles
    p.small.text-muted The endpoint URL is an explicit user destination. Region, retention and training notes are user supplied and shown as Not verified. V1 supports HTTPS OpenAI-compatible chat completions and no arbitrary headers.
    p.small.text-muted Test connection sends only a bodyless TLS HEAD without a prompt, model request or credential; it is a separate action from AI mode.
    p.small.text-muted(v-if="!settings.profiles.length") No endpoint profiles are saved.
    article.border.rounded.p-3.mb-2(v-for="profile in settings.profiles" :key="profile.profile_id" :aria-label="`Endpoint profile ${profile.display_name}`")
      h6 {{ profile.display_name }}
      p.mb-1 Origin: #[code {{ profile.origin }}] · Model: #[code {{ profile.model_id }}]
      p.mb-1 Destination class: {{ profile.destination_type }} · Protocol: {{ profile.protocol }} · Authentication: {{ profile.authentication }}
      p.mb-1 Region: {{ profile.region_note }} · Retention: {{ profile.retention_note }} · Training: {{ profile.training_note }} — Not verified
      p.mb-1(v-if="profile.resolved_addresses.length") TLS test pins: {{ profile.resolved_addresses.join(', ') }}
      p.mb-1(v-else) Connection has not been tested. This profile cannot be activated yet.
      p.mb-2(v-if="profile.credential_ref") Native credential: {{ credentialStatusText(profile) }}
      div.d-flex.flex-wrap
        b-button.mr-2(variant="outline-secondary" size="sm" type="button" @click="testSavedProfile(profile)" :disabled="!status.custom_endpoint_available || store.busy") Test connection
        b-button.mr-2(v-if="profile.credential_ref && store.credentialStatus[profile.credential_ref]" variant="outline-danger" size="sm" type="button" @click="deleteCredential(profile)" :disabled="store.busy") Delete credential
        b-button(variant="outline-danger" size="sm" type="button" @click="removeProfile(profile)" :disabled="store.busy || !canRemoveProfile(profile)") Remove profile
      p.small.text-muted.mt-2(v-if="profile.credential_ref && !canRemoveProfile(profile)") Delete the native credential as a separate action before removing this profile.
      p.small.text-muted.mt-2(v-if="testResults[profile.profile_id]") Last test: HTTP {{ testResults[profile.profile_id].http_status }}; TLS verified; {{ testResults[profile.profile_id].resolved_addresses.join(', ') }}

  section.mt-4(aria-labelledby="ai-add-endpoint-title")
    h6#ai-add-endpoint-title Add Custom Endpoint
    b-form-group(label="Profile name" label-for="ai-profile-name")
      b-form-input#ai-profile-name(v-model.trim="draft.display_name" maxlength="80" autocomplete="off" @input="draftTest = null")
    b-form-group(label="HTTPS origin" label-for="ai-origin")
      b-form-input#ai-origin(v-model.trim="draft.origin" type="url" placeholder="https://ai.example.net" autocomplete="off" @input="draftTest = null")
    b-form-group(label="API path" label-for="ai-path")
      b-form-input#ai-path(v-model.trim="draft.endpoint_path" maxlength="256" autocomplete="off" @input="draftTest = null")
    b-form-group(label="Model ID" label-for="ai-model")
      b-form-input#ai-model(v-model.trim="draft.model_id" maxlength="256" autocomplete="off" @input="draftTest = null")
    b-form-group(label="Destination class" label-for="ai-destination-type")
      b-form-select#ai-destination-type(v-model="draft.destination_type" :options="destinationOptions" @change="draftTest = null")
    b-form-group(label="Authentication" label-for="ai-authentication")
      b-form-select#ai-authentication(v-model="draft.authentication" :options="authenticationOptions" @change="draftTest = null")
    b-form-group(v-if="draft.authentication === 'bearer'" label="Bearer credential" label-for="ai-credential")
      b-form-input#ai-credential(v-model="credentialInput" type="password" autocomplete="off" maxlength="8192" :disabled="!status.native_secret_store_available")
      small.form-text.text-muted Saved directly to the native secret store; it is not part of the profile or WebUI storage.
    b-form-group(label="Region disclosure" label-for="ai-region-note")
      b-form-input#ai-region-note(v-model.trim="draft.region_note" maxlength="256" autocomplete="off" @input="draftTest = null")
    b-form-group(label="Retention disclosure" label-for="ai-retention-note")
      b-form-textarea#ai-retention-note(v-model.trim="draft.retention_note" maxlength="512" rows="2" autocomplete="off" @input="draftTest = null")
    b-form-group(label="Training disclosure" label-for="ai-training-note")
      b-form-textarea#ai-training-note(v-model.trim="draft.training_note" maxlength="512" rows="2" autocomplete="off" @input="draftTest = null")
    b-form-group(label="Optional cost note" label-for="ai-cost-note")
      b-form-input#ai-cost-note(v-model.trim="draft.cost_note" maxlength="512" autocomplete="off" @input="draftTest = null")
    div.d-flex.flex-wrap
      b-button.mr-2(variant="outline-secondary" type="button" @click="testDraft" :disabled="!status.custom_endpoint_available || store.busy || !draft.origin || !draft.endpoint_path || !draft.model_id") Test connection
      b-button(variant="primary" type="button" @click="saveDraft" :disabled="store.busy || !draft.display_name || !draft.origin || !draft.endpoint_path || !draft.model_id || !draft.region_note || !draft.retention_note || !draft.training_note || (draft.authentication === 'bearer' && (!status.native_secret_store_available || !credentialInput))") Save profile
    p.small.text-muted.mt-2(v-if="draftTest") Test result: HTTP {{ draftTest.http_status }}; TLS verified; address pins {{ draftTest.resolved_addresses.join(', ') }}. Save this exact profile to keep these pins.

  section.mt-4(aria-labelledby="ai-history-title")
    h6#ai-history-title Saved AI result history
    p.small.text-muted Results are saved only after you choose Save in the Work Report. History contains result text and source labels only; questions and aggregates are not saved. Maximum 50; the first saved result is removed when the limit is reached.
    p.small.text-muted(v-if="!store.history.length") No saved results.
    article.border.rounded.p-2.mb-2(v-for="insight in store.history" :key="insight.insight_id")
      p.small.mb-1 {{ insight.created_at }} · {{ insight.feature }} · {{ insight.source_mode }} · {{ insight.profile_label }} · {{ insight.model_id }}
      p.ai-history-text {{ insight.text }}
      b-button(variant="outline-danger" size="sm" type="button" aria-label="Delete saved insight" @click="store.deleteInsight(insight.insight_id)" :disabled="store.busy") Delete saved insight
    p.small.text-muted Ask a follow-up from the Work Report for the same report period; the resulting request is previewed again.
</section>
</template>

<script lang="ts">
import { useAIStore } from '~/stores/ai';
import type { AIEndpointProfile, AIDestinationType, AIAuthentication, AISettings } from '~/stores/ai';

function randomProfileId(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return `profile-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function emptyDraft() {
  return {
    profile_id: randomProfileId(),
    display_name: '',
    origin: '',
    endpoint_path: '/v1/chat/completions',
    protocol: 'openai_chat_completions_v1' as const,
    authentication: 'bearer' as AIAuthentication,
    model_id: '',
    destination_type: 'remote' as AIDestinationType,
    region_note: 'Not verified',
    retention_note: 'Not verified',
    training_note: 'Not verified',
    cost_note: null as string | null,
    credential_ref: 'cred-pending',
    resolved_addresses: [] as string[],
  };
}

export default {
  name: 'AISettings',
  data() {
    return {
      store: useAIStore(),
      draft: emptyDraft(),
      credentialInput: '',
      draftTest: null as { http_status: number; resolved_addresses: string[] } | null,
      testResults: {} as Record<string, { http_status: number; resolved_addresses: string[] }>,
      selectedProfileId: '',
      destinationOptions: [
        { value: 'remote', text: 'Remote' },
        { value: 'self_hosted', text: 'Self hosted' },
        { value: 'lan', text: 'LAN' },
        { value: 'paired_device', text: 'Paired device' },
        { value: 'central_sync_device', text: 'Central sync device' },
      ],
      authenticationOptions: [
        { value: 'none', text: 'No credential' },
        { value: 'bearer', text: 'Bearer token' },
      ],
    };
  },
  computed: {
    settings(): AISettings {
      return this.store.settings || { schema_version: 1, revision: 0, mode: 'off', active_connection_id: null, profiles: [] };
    },
    status() {
      return this.store.status || { custom_endpoint_available: false, native_secret_store_available: false };
    },
    modeLabel(): string {
      return this.settings.mode === 'off' ? 'Off' : this.settings.mode === 'custom_endpoint' ? 'Custom Endpoint' : 'Peak AI';
    },
    profileOptions() {
      return [{ value: '', text: 'Select a tested profile' }, ...this.settings.profiles
        .filter(profile => profile.resolved_addresses.length > 0
          && (profile.authentication === 'none' || this.store.credentialStatus[profile.credential_ref || '']))
        .map(profile => ({ value: profile.profile_id, text: `${profile.display_name} — ${profile.model_id}` }))];
    },
    canActivate(): boolean {
      return !!this.status.custom_endpoint_available;
    },
  },
  async created() {
    await this.store.refresh();
    await this.store.loadHistory();
    if (this.status.native_secret_store_available) {
      await Promise.all(this.settings.profiles.filter(profile => profile.credential_ref)
        .map(profile => this.store.hasCredential(profile.credential_ref as string)));
    }
  },
  methods: {
    credentialStatusText(profile: AIEndpointProfile): string {
      if (!profile.credential_ref) return 'No credential configured';
      const available = this.store.credentialStatus[profile.credential_ref];
      return available === true ? 'Present in native secret store' : available === false ? 'Deleted or missing' : 'Checking native secret store';
    },
    canRemoveProfile(profile: AIEndpointProfile): boolean {
      return !profile.credential_ref || this.store.credentialStatus[profile.credential_ref] === false;
    },
    async turnOff() {
      await this.store.saveSettings({ ...this.settings, mode: 'off', active_connection_id: null });
      this.selectedProfileId = '';
    },
    async activateSelected() {
      const profile = this.settings.profiles.find(item => item.profile_id === this.selectedProfileId);
      if (!profile || !profile.resolved_addresses.length
        || (profile.authentication === 'bearer' && !this.store.credentialStatus[profile.credential_ref || ''])) return;
      await this.store.saveSettings({ ...this.settings, mode: 'custom_endpoint', active_connection_id: profile.profile_id });
    },
    async testDraft() {
      const profile: AIEndpointProfile = {
        ...this.draft,
        credential_ref: this.draft.authentication === 'bearer' ? 'cred-pending' : null,
        resolved_addresses: [],
      };
      this.draftTest = await this.store.testConnection(profile);
    },
    async saveDraft() {
      if (!this.store.settings) return;
      let credentialRef: string | null = null;
      if (this.draft.authentication === 'bearer') {
        let secret = this.credentialInput;
        this.credentialInput = '';
        credentialRef = await this.store.saveCredential(secret);
        secret = '';
        if (!credentialRef) return;
      }
      const profile: AIEndpointProfile = {
        ...this.draft,
        credential_ref: credentialRef,
        resolved_addresses: this.draftTest?.resolved_addresses || [],
      };
      const next = { ...this.settings, profiles: [...this.settings.profiles, profile] };
      if (!await this.store.saveSettings(next)) {
        if (credentialRef) await this.store.deleteCredential(credentialRef);
        return;
      }
      this.credentialInput = '';
      this.draft = emptyDraft();
      this.draftTest = null;
    },
    async testSavedProfile(profile: AIEndpointProfile) {
      const result = await this.store.testConnection({ ...profile, resolved_addresses: [] });
      if (!result) return;
      const next = {
        ...this.settings,
        profiles: this.settings.profiles.map(item => item.profile_id === profile.profile_id
          ? { ...item, resolved_addresses: result.resolved_addresses }
          : item),
      };
      if (await this.store.saveSettings(next)) {
        this.testResults = { ...this.testResults, [profile.profile_id]: result };
      }
    },
    async deleteCredential(profile: AIEndpointProfile) {
      if (!profile.credential_ref) return;
      if (this.settings.active_connection_id === profile.profile_id && this.settings.mode !== 'off') {
        if (!await this.store.saveSettings({ ...this.settings, mode: 'off', active_connection_id: null })) return;
      }
      await this.store.deleteCredential(profile.credential_ref);
    },
    async removeProfile(profile: AIEndpointProfile) {
      if (!this.canRemoveProfile(profile)) return;
      const active = this.settings.active_connection_id === profile.profile_id;
      const next = {
        ...this.settings,
        mode: active ? 'off' as const : this.settings.mode,
        active_connection_id: active ? null : this.settings.active_connection_id,
        profiles: this.settings.profiles.filter(item => item.profile_id !== profile.profile_id),
      };
      if (await this.store.saveSettings(next)) delete this.testResults[profile.profile_id];
    },
  },
};
</script>

<style scoped>
.ai-history-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
