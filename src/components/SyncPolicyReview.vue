<template lang="pug">
section.mb-4(aria-labelledby="sync-policy-title")
  h5#sync-policy-title Settings from other devices
  p.text-muted Review each value before replacing the local setting. Receiving a change does not apply it.
  p.text-danger(v-if="policies.error" role="alert") {{ errorMessage }}
  p.text-success(v-if="policies.notice === 'kept'" role="status") Local value kept.
  p.text-success(v-if="policies.notice === 'accepted' && !policies.reloadPending" role="status") Remote value saved and reloaded.
  div(v-if="policies.reloadPending" role="status")
    p The remote value was saved. Reload {{ label(policies.reloadPending) }} after saving or discarding open drafts.
    button.btn.btn-outline-secondary(type="button" data-policy-retry :disabled="!active || applying || blocked" @click="applyPending") Retry reload
  button.btn.btn-outline-secondary.mb-2(type="button" data-policy-refresh :disabled="!active || policies.busy || applying || !!policies.reloadPending" @click="policies.load()") Refresh pending changes
  p.text-muted(v-if="!policies.busy && !policies.candidates.length && !policies.reloadPending") No pending changes are stored locally.
  ul.list-unstyled
    li.mb-2(v-for="item in policies.candidates" :key="item.candidate_id")
      button.btn.btn-outline-primary(type="button" data-policy-review :disabled="!active || policies.busy || applying || !!policies.reloadPending" @click="policies.select(item.candidate_id)") Review {{ label(item.field) }}
      span.small.text-muted.ml-2(v-if="item.recovery_source") Recovery snapshot {{ item.recovery_source.snapshot_id }} · key epoch {{ item.recovery_source.key_epoch }}
      span.small.text-muted.ml-2(v-else) Device {{ item.device_id }} · revision {{ item.policy_version }}
  button.btn.btn-outline-secondary(type="button" v-if="policies.hasMore" :disabled="!active || policies.busy || applying || !!policies.reloadPending" @click="policies.load(policies.nextCursor)") Load more changes
  div.mt-3(v-if="policies.preview")
    h6 {{ label(policies.preview.policy.candidate.field) }}
    p.small Values below preserve reset, stored null and empty lists as separate choices.
    strong Local value
    pre.policy-value(data-policy-current v-text="policies.preview.policy.current.present ? policies.preview.currentRaw : 'Default (no stored value)'")
    strong Remote value
    pre.policy-value(data-policy-proposed v-text="policies.preview.policy.proposed.present ? policies.preview.proposedRaw : 'Default (no stored value)'")
    details.mb-3(v-if="policies.preview.firewallRaw !== 'null'")
      summary Privacy Firewall changes
      pre.policy-value(v-text="policies.preview.firewallRaw")
    p.text-warning(v-if="!policies.preview.accept_remote_available") The Privacy Firewall could not verify this change. You can keep the local value or refresh the review later.
    p.text-muted(v-if="blocked") Save or discard open drafts before accepting a remote value.
    button.btn.btn-outline-secondary.mr-2(type="button" data-policy-keep :disabled="!active || policies.busy || applying" @click="choose('keep-local')") Keep local value
    button.btn.btn-primary(type="button" data-policy-accept :disabled="!active || policies.busy || applying || blocked || !policies.preview.accept_remote_available" @click="choose('accept-remote')") Accept remote value
  p.small.text-muted(v-if="policies.busy || applying" role="status") Checking local settings…
</template>

<script lang="ts">
import { useSyncPolicyStore } from '~/stores/syncPolicies';
import { applyPolicyChoice, policyBlocked } from '~/util/policyApply';
import type { PolicyDecision, PolicyField } from '~/util/policyContracts';

const labels: Record<PolicyField, string> = {
  'settings.startOfDay': 'Start of day',
  'settings.startOfWeek': 'Start of week',
  'settings.durationDefault': 'Timeline duration',
  'settings.useColorFallback': 'Fallback colors',
  'settings.landingpage': 'Landing page',
  'settings.theme': 'Theme',
  'settings.always_active_pattern': 'Always-active applications',
  'settings.privacy_filters': 'Privacy filters',
  'settings.classes': 'Categories',
  'settings.category_sets': 'Category sets',
  'settings.active_set_ids': 'Active category sets',
  'settings.views': 'Saved views',
  'settings.saved_queries': 'Saved queries',
  'settings.ignoredCategorySuggestions': 'Ignored category suggestions',
  'settings.showYearly': 'Yearly reports',
  'settings.useMultidevice': 'Multiple-device reports',
  'settings.rawRetentionDays': 'Raw data retention',
  'settings.uncategorizedNotificationData': 'Uncategorized activity reminders',
  'capture.minimization': 'Capture privacy controls',
  'egress.user_policy': 'Privacy Firewall user rules',
  'egress.signed_bundle': 'Privacy Firewall signed destinations',
};
const errors = {
  'source-unavailable': 'The local vault could not be verified. Unlock it if needed and retry.',
  'invalid-response': 'The local policy response could not be verified. Refresh the review.',
  'context-changed': 'The vault changed. Refresh the review.',
  'stale-review': 'These settings changed since the review. Refresh before choosing.',
  'request-failed': 'The local request failed. Refresh the review before trying again.',
  draft: 'Save or discard open drafts before accepting a remote value.',
  'reload-pending': 'Reload the accepted setting before reviewing another change.',
};
export default {
  name: 'SyncPolicyReview',
  props: { active: { type: Boolean, default: true } },
  data() {
    return { policies: useSyncPolicyStore(), applying: false, disposed: false };
  },
  computed: {
    blocked(): boolean {
      return policyBlocked();
    },
    errorMessage(): string {
      return errors[this.policies.error] || '';
    },
  },
  watch: {
    active: {
      immediate: true,
      handler(value: boolean) {
        if (value && !this.disposed && !this.policies.reloadPending) void this.policies.load();
      },
    },
  },
  beforeDestroy() {
    this.disposed = true;
    this.policies.clearSensitive();
  },
  methods: {
    label(field: PolicyField): string {
      return labels[field];
    },
    async choose(decision: PolicyDecision) {
      if (!this.active || this.disposed || this.applying) return;
      const ack = await this.policies.choose(decision, policyBlocked);
      if (ack?.applied && !this.disposed) await this.applyPending();
    },
    async applyPending() {
      const ack = this.policies.lastChoice;
      if (!ack || !this.active || this.disposed || this.applying) return;
      this.applying = true;
      try {
        const owned = async () =>
          this.active &&
          !this.disposed &&
          (await this.policies.canApplyChoice(ack, policyBlocked)) &&
          this.active &&
          !this.disposed;
        if ((await applyPolicyChoice(ack, owned)) && (await owned()))
          this.policies.markReloaded(ack);
      } finally {
        this.applying = false;
      }
    },
  },
};
</script>

<style scoped>
.policy-value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 20rem;
  overflow: auto;
}
</style>
