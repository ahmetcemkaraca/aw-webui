<template lang="pug">
section.mt-4.plugin-actions(aria-labelledby="plugin-actions-title")
  h6#plugin-actions-title Action preview: {{ plugin.manifest.display_name }}
  p.small Review each action separately. Previewing does not approve annotations or send data. Expires: {{ invocation.expires_at }}.
  p.text-danger(role="alert" v-if="error") {{ error }}
  p(role="status" aria-live="polite" v-if="notice") {{ notice }}
  article(v-for="(output, index) in invocation.ui" :key="'ui-' + index")
    h6 {{ output.title }}
    p {{ output.text }}
  section.mt-3(v-if="invocation.writes.length && !writesSaved" aria-labelledby="plugin-writes-title")
    h6#plugin-writes-title Proposed local annotations
    pre {{ format(invocation.writes) }}
    label.d-block
      input.mr-2(type="checkbox" v-model="writesConfirmed" :disabled="busy || !available")
      | Save these exact annotations in this plugin’s encrypted storage.
    button.btn.btn-outline-primary(type="button" @click="approveWrites" :disabled="busy || !available || !writesConfirmed") Approve and save annotations once
  section.mt-3(v-if="invocation.destructive_confirmations.length" aria-labelledby="plugin-scoped-actions-title")
    h6#plugin-scoped-actions-title Actions requiring separate confirmation
    article.border-top.py-3(v-for="(action, index) in invocation.destructive_confirmations" :key="'action-' + index")
      h6 {{ action.action === 'delete' ? 'Delete plugin-owned data' : action.action === 'export' ? 'Export plugin-owned data' : 'Release a network request for review' }}
      p Resource: {{ action.resource_id }} · Snapshot: {{ action.snapshot_sha256 }}
      p Storage keys: {{ (action.storage_keys || []).join(', ') || 'None' }} · Annotations: {{ action.event_count }} · Payload bytes: {{ action.payload_bytes }}
      p(v-if="action.action === 'delete'") This permanently deletes only this plugin’s displayed storage and annotations. Activity data and the installed plugin are preserved.
      p(v-else-if="action.action === 'export'") This downloads the displayed plugin-owned snapshot as unencrypted JSON. Choose where to keep the exported file.
      p(v-else) This releases the named network preview. It does not send anything; review and approve its exact destination and payload separately below.
      p.small(v-if="!actionSupported(action)") This action is unavailable because its resource is not supported.
      p(role="status" v-if="action.approved || actionsConsumed[index]") {{ actionsConsumed[index] === 'uncertain' ? 'Approval attempted; check history before requesting another preview.' : 'Action approved for this preview.' }}
      template(v-else)
        label.d-block
          input.mr-2(type="checkbox" v-model="actionsConfirmed[index]" :disabled="busy || !available || !actionSupported(action)")
          | {{ action.action === 'delete' ? 'Delete this exact plugin-owned snapshot.' : action.action === 'export' ? 'Export this exact snapshot to an unencrypted local JSON file.' : 'Release this exact network request for Privacy Firewall review.' }}
        button.btn.btn-danger(type="button" @click="approveAction(index)" :disabled="busy || !available || !actionsConfirmed[index] || !actionSupported(action)") {{ action.action === 'export' ? 'Approve export and download JSON' : action.action === 'delete' ? 'Approve deletion once' : 'Approve and reveal network preview' }}
  section.mt-3(v-for="(preview, index) in networkPreviews" :key="'network-' + index" :aria-label="'Network action ' + (index + 1)")
    h6 Network request {{ index + 1 }}
    p Destination: {{ preview.destination_origin || 'Unavailable' }} · Purpose: {{ preview.purpose_id || 'Unavailable' }}
    p Retention: {{ preview.retention_disclosure || 'Unavailable' }}
    template(v-if="preview.decision")
      p Policy version: {{ preview.decision.policy_version }} · Decision: {{ preview.decision.outcome }} · Approval scope: once
      p(v-if="preview.decision.reason_codes.length") {{ preview.decision.reason_codes.join(', ') }}
      p(v-if="preview.decision.removed_fields.length") Removed fields: {{ preview.decision.removed_fields.join(', ') }}
      pre {{ format(preview.decision.sanitized_payload) }}
    p.small(v-if="!networkReviewable(preview)") Sending is unavailable without a complete destination, purpose, retention disclosure and allowed Privacy Firewall preview.
    label.d-block
      input.mr-2(type="checkbox" v-model="networkConfirmed[index]" :disabled="busy || !available || !networkReviewable(preview) || networkConsumed[index]")
      | I approve this exact displayed payload for this destination and purpose.
    button.btn.btn-danger(type="button" @click="sendNetwork(index)" :disabled="busy || !available || !networkConfirmed[index] || !networkReviewable(preview) || networkConsumed[index]") {{ networkConsumed[index] ? 'Preview consumed — run again for a new preview' : 'Approve and send once' }}
  section.mt-3(v-if="invocation.ai_requests.length" aria-labelledby="plugin-ai-title")
    h6#plugin-ai-title Optional AI drafts from this plugin
    p.small These drafts start a new host AI request only when you choose Preview exact request below. Review the current connection and payload before separately approving a send.
    label(for="plugin-ai-request") Request to review
    select#plugin-ai-request.form-control(v-model.number="aiIndex" :disabled="busy || aiStore.busy" @change="aiStore.clearPreview()")
      option(v-for="(request, index) in invocation.ai_requests" :key="index" :value="index") {{ index + 1 }}: {{ request.feature }}
    AIReportExplanation(v-if="aiRequest && available && aiRequest.profile_id === aiStore.settings?.active_connection_id" :key="invocation.invocation_id + '-' + aiIndex" :aggregate="aiRequest.aggregate" id-prefix="plugin-ai" title="Review plugin AI request" :default-question="aiRequest.question" :features="[aiRequest.feature]" :show-history="false")
    p.small(v-else) The plugin’s requested AI connection is not active. Review AI settings and run the plugin again; no AI request has been sent.
  button.btn.btn-outline-secondary.mt-3(type="button" @click="close" :disabled="busy || aiStore.busy") Close action preview
</section>
</template>

<script lang="ts">
import Vue from 'vue';
import { getClient } from '~/util/awclient';
import { useAIStore } from '~/stores/ai';
import AIReportExplanation from '~/components/AIReportExplanation.vue';

export default Vue.extend({
  name: 'PluginActions',
  components: { AIReportExplanation },
  props: { invocation: { type: Object, required: true }, plugin: { type: Object, required: true }, available: { type: Boolean, required: true } },
  data() {
    return {
      busy: false, error: '', notice: '', writesConfirmed: false, writesSaved: this.invocation.writes_approved === true,
      networkConfirmed: {} as Record<number, boolean>, networkConsumed: {} as Record<number, boolean>,
      actionsConfirmed: {} as Record<number, boolean>, actionsConsumed: {} as Record<number, string>,
      releasedNetwork: {} as Record<number, any>,
      aiIndex: 0, aiStore: useAIStore(),
    };
  },
  computed: {
    aiRequest(): any { return this.invocation.ai_requests[this.aiIndex]; },
    networkPreviews(): any[] { return this.invocation.network_previews.map((preview: any, index: number) => this.releasedNetwork[index] || preview); },
    actionBusy(): boolean { return this.busy || this.aiStore.busy; },
  },
  watch: { actionBusy(value: boolean) { this.$emit('busy', value); } },
  created() { if (this.invocation.ai_requests.length) this.aiStore.refresh(); },
  beforeDestroy() { this.aiStore.clearPreview(); this.$emit('busy', false); },
  methods: {
    format(value: unknown): string { return JSON.stringify(value, null, 2); },
    live(): boolean {
      if (this.available && Date.parse(this.invocation.expires_at) > Date.now()) return true;
      this.error = 'This preview is expired or unavailable. Run the plugin again to review a fresh preview.';
      return false;
    },
    networkReviewable(preview: any): boolean {
      return !!(preview.destination_origin && preview.purpose_id && preview.retention_disclosure
        && preview.decision?.preview_id && preview.decision?.outcome === 'allow');
    },
    async approveWrites() {
      if (this.busy || !this.writesConfirmed || this.writesSaved || !this.live()) return;
      this.busy = true;
      this.error = '';
      // One attempt per preview; uncertain responses require a fresh server preview.
      this.writesSaved = true;
      try {
        await getClient().req.post(`/api/0/plugins/${encodeURIComponent(this.plugin.manifest.plugin_id)}/writes/approve`, {
          invocation_id: this.invocation.invocation_id, package_sha256: this.plugin.package_sha256, confirmed: true,
        });
        this.notice = 'Approved annotations saved.';
        this.$emit('saved');
      } catch (_) { this.error = 'Annotation approval could not be confirmed. Check plugin history before running again.'; }
      finally { this.writesConfirmed = false; this.busy = false; }
    },
    actionSupported(action: any): boolean {
      return ((action.action === 'delete' || action.action === 'export') && action.resource_id === 'plugin_owned_data')
        || (action.action === 'send' && /^network:(0|[1-9][0-9]*)$/.test(action.resource_id)
          && Number(action.resource_id.split(':')[1]) < this.invocation.network_previews.length);
    },
    async approveAction(index: number) {
      const action = this.invocation.destructive_confirmations[index];
      if (this.busy || !action || action.approved || this.actionsConsumed[index]
        || !this.actionsConfirmed[index] || !this.actionSupported(action) || !this.live()) return;
      this.busy = true;
      this.error = '';
      this.$set(this.actionsConsumed, index, 'uncertain');
      try {
        const { data } = await getClient().req.post(`/api/0/plugins/${encodeURIComponent(this.plugin.manifest.plugin_id)}/actions/approve`, {
          package_sha256: this.plugin.package_sha256, invocation_id: this.invocation.invocation_id,
          action_index: index, confirmed: true,
        });
        if (data.action !== action.action) throw new Error('Unexpected action result');
        this.$set(this.actionsConsumed, index, 'approved');
        if (action.action === 'send') {
          const networkIndex = Number(action.resource_id.split(':')[1]);
          this.$set(this.releasedNetwork, networkIndex, data.network_preview);
          this.$set(this.networkConfirmed, networkIndex, false);
          this.notice = 'Network preview released. Review its payload and separately approve a send below.';
        } else if (action.action === 'export') {
          const url = URL.createObjectURL(new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = `${this.plugin.manifest.plugin_id}-data.json`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          this.notice = 'Approved export prepared; local JSON download requested.';
        } else {
          this.notice = 'The approved plugin-owned storage and annotations were deleted. Activity data was preserved.';
        }
      } catch (_) { this.error = 'Action completion could not be confirmed. Check plugin history and refresh before requesting another preview.'; }
      finally { this.$set(this.actionsConfirmed, index, false); this.busy = false; }
    },
    async sendNetwork(index: number) {
      const preview = this.networkPreviews[index];
      if (this.busy || !this.networkConfirmed[index] || this.networkConsumed[index] || !this.networkReviewable(preview) || !this.live()) return;
      this.busy = true;
      this.error = '';
      this.$set(this.networkConsumed, index, true);
      try {
        const { data } = await getClient().req.post('/api/0/egress/approve', {
          preview_id: preview.decision.preview_id, scope: 'once', expires_at: this.invocation.expires_at,
        });
        if (!this.live()) return;
        await getClient().req.post('/api/0/egress/send', { preview_id: preview.decision.preview_id, approval_id: data.approval_id });
        this.notice = 'Approved request sent through the Privacy Firewall. Its receipt is available in Privacy Firewall settings.';
      } catch (_) { this.error = 'Network send could not be confirmed. Check Privacy Firewall receipts before trying a new preview.'; }
      finally { this.$set(this.networkConfirmed, index, false); this.busy = false; }
    },
    close() { this.aiStore.clearPreview(); this.$emit('close'); },
  },
});
</script>

<style scoped>
.plugin-actions pre, .plugin-actions p { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
