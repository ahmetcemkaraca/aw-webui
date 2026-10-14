<template lang="pug">
section(aria-labelledby="privacy-firewall-title")
  h5#privacy-firewall-title Privacy Firewall
  p.small.text-muted Status: {{ statusLabel('privacy-firewall') || 'Available' }}. Local history stays available when outbound sending is blocked.
  p(role="status" aria-live="polite") {{ statusMessage }}
  p.text-danger(role="alert" v-if="error") {{ error }}
  div.d-flex.flex-wrap.align-items-center
    button.btn.btn-sm.btn-outline-danger(
      v-if="status"
      type="button"
      :aria-label="status.kill_switch_enabled ? 'Disable outbound kill switch' : 'Enable outbound kill switch'"
      :aria-pressed="status.kill_switch_enabled"
      :disabled="busy"
      @click="toggleKillSwitch"
    ) {{ status.kill_switch_enabled ? 'Outbound kill switch is on' : 'Outbound kill switch is off' }}
    button.btn.btn-sm.btn-outline-secondary.ml-2(type="button" :disabled="busy" @click="refresh") Refresh status
  p.small.text-muted(v-if="status && !status.trusted_policy_keys") No trusted policy signing key is configured. Outbound requests remain unavailable.

  section.mt-3(v-if="status && status.trusted_policy_keys" aria-labelledby="signed-policy-title")
    h6#signed-policy-title Review a signed policy update
    p.small.text-muted Only a bundle signed by a configured release key can be reviewed or accepted.
    label.d-block(for="egress-signed-policy") Signed policy bundle (JSON)
    textarea#egress-signed-policy.form-control(aria-label="Signed policy bundle JSON" v-model="signedPolicyJson" rows="5" spellcheck="false")
    button.btn.btn-sm.btn-outline-primary.mt-2(type="button" aria-label="Preview signed policy changes" :disabled="busy || !signedPolicyJson.trim()" @click="previewSignedPolicy") Preview signed policy diff
    section.mt-2(v-if="signedPolicyPreview" aria-labelledby="signed-policy-diff-title")
      h6#signed-policy-diff-title Reviewed signed policy diff
      ul
        li(v-for="(line, index) in signedPolicyDiffLines" :key="index") {{ line }}
      button.btn.btn-sm.btn-primary(type="button" aria-label="Accept signed policy changes" :disabled="busy" @click="acceptSignedPolicy") Accept this exact policy diff

  section.mt-3(v-if="policy" aria-labelledby="egress-preview-title")
    h6#egress-preview-title Review an outbound request
    label.d-block(for="egress-destination") Destination
    select#egress-destination.form-control(v-model="destinationId" @change="selectPurpose")
      option(v-for="destination in destinations" :key="destination.id" :value="destination.id") {{ destination.id }} — {{ destination.https_origin }}
    label.d-block.mt-2(for="egress-purpose") Purpose
    select#egress-purpose.form-control(v-model="purposeId")
      option(v-for="purpose in purposes" :key="purpose.id" :value="purpose.id") {{ purpose.id }}
    label.d-block.mt-2(for="egress-payload") Candidate request payload (JSON)
    textarea#egress-payload.form-control(v-model="candidatePayload" aria-label="Candidate request payload" rows="5" spellcheck="false")
    button.btn.btn-sm.btn-outline-primary.mt-2(type="button" aria-label="Preview sanitized request" :disabled="busy || !purposeId" @click="previewCandidate") Preview sanitized request
    section.mt-2(v-if="preview" aria-labelledby="egress-preview-result-title")
      h6#egress-preview-result-title Request review
      p Destination: {{ preview.destination_id }} — {{ preview.destination_origin || 'unregistered' }}
      p Purpose: {{ preview.purpose_id }}
      p Retention: {{ preview.retention_id }} — {{ preview.retention_disclosure || 'No matching retention disclosure' }}
      p(role="status" aria-live="polite") Decision: {{ preview.decision.outcome }}{{ preview.decision.reason_codes.length ? ` — ${preview.decision.reason_codes.join(', ')}` : '' }}
      ul(v-if="preview.decision.removed_fields.length")
        li(v-for="field in preview.decision.removed_fields" :key="field") Removed field: {{ field }}
      pre(v-if="preview.decision.sanitized_payload") {{ JSON.stringify(preview.decision.sanitized_payload, null, 2) }}
      label.d-block.mt-2(for="egress-existing-approval") Existing approval
      select#egress-existing-approval.form-control(v-model="selectedApprovalId" @change="approvalSelectionRevision++")
        option(value="") Create a new approval
        option(v-for="approval in reusableApprovals" :key="approval.approval_id" :value="approval.approval_id") {{ approval.scope }} — {{ approval.expires_at || 'until revoked' }}
      p.small.text-muted(v-if="selectedApprovalId") Saved approvals only apply to the exact same sanitized payload; the server checks it before sending.
      template(v-else)
        label.d-block.mt-2(for="egress-approval-scope") Approval scope
        select#egress-approval-scope.form-control(v-model="approvalScope" @change="approvalSelectionRevision++")
          option(value="once") This request only
          option(value="time_limited") This exact payload for one hour
          option(value="destination_specific") This exact payload for this destination
      button.btn.btn-sm.btn-primary.mt-2(
        type="button"
        :aria-label="selectedApprovalId ? 'Send with existing approval' : 'Approve and send exact preview'"
        :disabled="busy || !status || !status.outbound_enabled || preview.decision.outcome !== 'allow'"
        @click="sendPreview"
      ) {{ selectedApprovalId ? 'Send with existing approval' : 'Approve and send exact preview' }}

  h6.mt-3 Local restrictions
  p.small.text-muted These rules can only deny or remove data. Review the change summary before saving.
  p.small.text-muted Presets are editable starting points; adjust their matches to fit your activity.
  div.d-flex.flex-wrap.mb-2
    button.btn.btn-sm.btn-outline-secondary.mr-2(type="button" aria-label="Add password-manager rules preset" @click="addPasswordManagerPreset") Add password-manager preset
    button.btn.btn-sm.btn-outline-secondary(type="button" aria-label="Add sensitive-activity rules preset" @click="addSensitiveActivityPreset") Add sensitive-activity preset
  div(v-for="(rule, index) in userPolicy.user_rules" :key="`rule-${index}`" class="d-flex flex-wrap align-items-center mb-2")
    select.form-control.mr-2(v-model="rule.pattern.kind" :aria-label="`Rule type ${index + 1}`")
      option(value="application") Application
      option(value="domain") Domain
      option(value="keyword") Keyword
      option(value="field") Field
    input.form-control.mr-2(v-model.trim="rule.pattern.value" :aria-label="`Rule match ${index + 1}`" maxlength="256")
    select.form-control.mr-2(v-model="rule.action" :aria-label="`Rule action ${index + 1}`")
      option(value="deny") Deny request
      option(value="drop_field") Remove field
      option(value="redact_value") Redact value
      option(value="domain_only") Keep domain only
      option(value="stable_alias") Replace with local alias
    button.btn.btn-sm.btn-outline-danger(type="button" :aria-label="`Remove rule ${index + 1}`" @click="userPolicy.user_rules.splice(index, 1)") Remove
  button.btn.btn-sm.btn-outline-secondary(type="button" @click="addRule") Add rule

  h6.mt-3 Personal Safe Zone
  p.small.text-muted Matching activity is denied from outbound requests.
  div(v-for="(pattern, index) in userPolicy.safe_zone_patterns" :key="`zone-${index}`" class="d-flex flex-wrap align-items-center mb-2")
    select.form-control.mr-2(v-model="pattern.kind" :aria-label="`Safe Zone match type ${index + 1}`")
      option(value="application") Application
      option(value="domain") Domain
      option(value="keyword") Keyword
      option(value="field") Field
    input.form-control.mr-2(v-model.trim="pattern.value" :aria-label="`Safe Zone match ${index + 1}`" maxlength="256")
    button.btn.btn-sm.btn-outline-danger(type="button" :aria-label="`Remove Safe Zone pattern ${index + 1}`" @click="userPolicy.safe_zone_patterns.splice(index, 1)") Remove
  button.btn.btn-sm.btn-outline-secondary(type="button" aria-label="Add Safe Zone pattern" @click="addSafeZonePattern") Add Safe Zone pattern

  h6.mt-3 After-hours hard stop
  label.d-block(for="egress-after-hours-enabled")
    input#egress-after-hours-enabled(type="checkbox" v-model="afterHoursEnabled")
    |  Block outbound requests during the selected local hours
  div(v-if="userPolicy.after_hours")
    div.d-flex.flex-wrap.align-items-center.mb-2
      label.mr-2(for="egress-after-hours-start") Start
      input#egress-after-hours-start.form-control.mr-3(type="time" v-model="afterHoursStart")
      label.mr-2(for="egress-after-hours-end") End
      input#egress-after-hours-end.form-control(type="time" v-model="afterHoursEnd")
    div
      label.mr-3(v-for="day in days" :key="day.value")
        input(type="checkbox" v-model="userPolicy.after_hours.weekdays" :value="day.value")
        |  {{ day.label }}

  p.small(role="status" aria-live="polite") {{ policyDiff }}
  button.btn.btn-sm.btn-primary.mt-2(type="button" aria-label="Preview local policy diff" :disabled="busy || !hasPolicyChanges" @click="previewUserPolicy") Preview local changes
  section.mt-2(v-if="policyPreview" aria-labelledby="local-policy-diff-title")
    h6#local-policy-diff-title Reviewed local policy diff
    ul
      li(v-for="(rule, index) in policyPreview.diff.added_user_rules" :key="`add-rule-${index}`") Added {{ rule.pattern.kind }} match “{{ rule.pattern.value }}” — {{ rule.action }}
      li(v-for="(rule, index) in policyPreview.diff.removed_user_rules" :key="`remove-rule-${index}`") Removed {{ rule.pattern.kind }} match “{{ rule.pattern.value }}” — {{ rule.action }}
      li(v-for="(pattern, index) in policyPreview.diff.added_safe_zone_patterns" :key="`add-zone-${index}`") Added Safe Zone {{ pattern.kind }} match “{{ pattern.value }}”
      li(v-for="(pattern, index) in policyPreview.diff.removed_safe_zone_patterns" :key="`remove-zone-${index}`") Removed Safe Zone {{ pattern.kind }} match “{{ pattern.value }}”
      li(v-if="!sameSchedule(policyPreview.diff.after_hours_before, policyPreview.diff.after_hours_after)") Changed after-hours schedule
    button.btn.btn-sm.btn-primary(type="button" aria-label="Accept local policy changes" :disabled="busy" @click="acceptUserPolicy") Accept and save local changes
  p.small.text-muted.mt-2 Exact payload preview and sending remain unavailable until a trusted signed destination policy is installed.

  h6.mt-3 Recent receipts
  p.small.text-muted(v-if="!receipts.length && !loading") No outbound receipts.
  ul(v-else)
    li(v-for="receipt in receipts" :key="receipt.created_at + receipt.destination_id + receipt.purpose_id")
      | {{ receipt.created_at }} — {{ receipt.destination_id }} / {{ receipt.purpose_id }}
      | — retention: {{ receipt.retention_id }} — {{ receipt.decision }} ({{ receipt.scope }})
      | — fields: {{ receipt.allowed_fields.join(', ') }}
  h6.mt-3 Active outbound approvals
  p.small.text-muted(v-if="!approvals.length") No active outbound approvals.
  ul(v-else)
    li(v-for="approval in approvals" :key="approval.approval_id") {{ approval.destination_id }} / {{ approval.purpose_id }} — {{ approval.scope }} — {{ approval.expires_at || 'until revoked' }}
  button.btn.btn-sm.btn-outline-danger.mt-2(type="button" aria-label="Revoke all approvals" :disabled="busy || !approvals.length" @click="revokeApprovals") Revoke all approvals
</template>

<script lang="ts">
import { registerPolicyDraft } from '~/util/policyDrafts';
import { getClient } from '~/util/awclient';
import experience from '~/generated/product-experience.json';
import { statusLabel } from '~/product/experience';

const emptyPolicy = () => ({
  schema_version: 1,
  user_rules: [],
  safe_zone_patterns: [],
  after_hours: null,
});
const copy = value => JSON.parse(JSON.stringify(value));
const formatMinute = value =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const parseMinute = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export default {
  name: 'PrivacyFirewallSettings',
  data() {
    const policy = emptyPolicy();
    return {
      status: null,
      receipts: [],
      policy: null,
      approvals: [],
      destinationId: '',
      purposeId: '',
      candidatePayload: '{}',
      approvalScope: 'once',
      selectedApprovalId: '',
      preview: null,
      userPolicy: policy,
      savedPolicy: copy(policy),
      policyPreview: null,
      signedPolicyJson: '',
      signedPolicyPreview: null,
      loading: false,
      unregisterPolicyDraft: null,
      busy: false,
      error: '',
      requestGeneration: 0,
      reviewRevision: 0,
      approvalSelectionRevision: 0,
      disposed: false,
      days: [
        { value: 1, label: 'Mon' },
        { value: 2, label: 'Tue' },
        { value: 3, label: 'Wed' },
        { value: 4, label: 'Thu' },
        { value: 5, label: 'Fri' },
        { value: 6, label: 'Sat' },
        { value: 7, label: 'Sun' },
      ],
    };
  },
  computed: {
    statusLabel(): (id: string) => string {
      return id => statusLabel(id, experience);
    },
    statusMessage(): string {
      if (!this.status)
        return this.loading
          ? 'Loading Privacy Firewall status…'
          : 'Privacy Firewall status is unavailable; outbound requests remain blocked.';
      if (this.status.outbound_enabled)
        return 'Outbound sending is available through the trusted Privacy Firewall policy.';
      if (this.status.kill_switch_enabled)
        return 'Outbound sending is blocked by the local kill switch.';
      return 'Outbound sending is unavailable until a trusted policy bundle is configured.';
    },
    destinations(): any[] {
      return (this.policy?.destinations || []).filter(destination =>
        ['available', 'beta', 'experimental'].includes(destination.status)
      );
    },
    purposes(): any[] {
      return (this.policy?.purposes || []).filter(
        purpose => purpose.destination_id === this.destinationId
      );
    },
    reusableApprovals(): any[] {
      return this.approvals.filter(
        approval =>
          approval.destination_id === this.destinationId &&
          approval.purpose_id === this.purposeId &&
          approval.retention_id ===
            this.purposes.find(item => item.id === this.purposeId)?.retention_id &&
          approval.policy_version === this.policy?.version
      );
    },
    signedPolicyDiffLines(): string[] {
      if (!this.signedPolicyPreview) return [];
      const diff = this.signedPolicyPreview.diff;
      const lines = [
        `Policy version ${diff.from_version} → ${diff.to_version}`,
        `Hard-deny version ${diff.hard_deny_version_before} → ${diff.hard_deny_version_after}`,
      ];
      for (const item of diff.added_destinations)
        lines.push(`Added destination ${item.id} — ${item.https_origin || 'planned'}`);
      for (const item of diff.removed_destinations) lines.push(`Removed destination ${item}`);
      for (const item of diff.changed_destinations)
        lines.push(`Changed destination ${item.id} — ${item.https_origin || 'planned'}`);
      for (const item of diff.added_purposes)
        lines.push(`Added purpose ${item.id} — ${item.retention_disclosure}`);
      for (const item of diff.removed_purposes) lines.push(`Removed purpose ${item}`);
      for (const item of diff.changed_purposes)
        lines.push(`Changed purpose ${item.id} — ${item.retention_disclosure}`);
      for (const item of diff.added_organization_rules)
        lines.push(
          `Added organization rule ${item.pattern.kind}:${item.pattern.value} — ${item.action}`
        );
      for (const item of diff.removed_organization_rules)
        lines.push(
          `Removed organization rule ${item.pattern.kind}:${item.pattern.value} — ${item.action}`
        );
      for (const item of diff.added_safe_zone_patterns)
        lines.push(`Added Safe Zone ${item.kind}:${item.value}`);
      for (const item of diff.removed_safe_zone_patterns)
        lines.push(`Removed Safe Zone ${item.kind}:${item.value}`);
      if (!same(diff.after_hours_before, diff.after_hours_after))
        lines.push('Changed after-hours schedule');
      return lines;
    },
    hasPolicyChanges(): boolean {
      return !same(this.userPolicy, this.savedPolicy);
    },
    policyDiff(): string {
      const addedRules = this.userPolicy.user_rules.filter(
        rule => !this.savedPolicy.user_rules.some(saved => same(rule, saved))
      ).length;
      const removedRules = this.savedPolicy.user_rules.filter(
        rule => !this.userPolicy.user_rules.some(draft => same(rule, draft))
      ).length;
      const addedZones = this.userPolicy.safe_zone_patterns.filter(
        pattern => !this.savedPolicy.safe_zone_patterns.some(saved => same(pattern, saved))
      ).length;
      const removedZones = this.savedPolicy.safe_zone_patterns.filter(
        pattern => !this.userPolicy.safe_zone_patterns.some(draft => same(pattern, draft))
      ).length;
      const changes = [];
      if (addedRules) changes.push(`Added ${addedRules} rule${addedRules === 1 ? '' : 's'}`);
      if (removedRules)
        changes.push(`Removed ${removedRules} rule${removedRules === 1 ? '' : 's'}`);
      if (addedZones)
        changes.push(`Added ${addedZones} Safe Zone pattern${addedZones === 1 ? '' : 's'}`);
      if (removedZones)
        changes.push(`Removed ${removedZones} Safe Zone pattern${removedZones === 1 ? '' : 's'}`);
      if (!same(this.userPolicy.after_hours, this.savedPolicy.after_hours))
        changes.push('Changed after-hours schedule');
      return changes.length
        ? `${changes.join('; ')}. These changes apply locally when saved.`
        : 'No unsaved local policy changes.';
    },
    afterHoursEnabled: {
      get(): boolean {
        return Boolean(this.userPolicy.after_hours);
      },
      set(enabled: boolean) {
        this.userPolicy.after_hours = enabled
          ? { weekdays: [1, 2, 3, 4, 5], start_minute: 1080, end_minute: 480 }
          : null;
      },
    },
    afterHoursStart: {
      get(): string {
        return this.userPolicy.after_hours
          ? formatMinute(this.userPolicy.after_hours.start_minute)
          : '';
      },
      set(value: string) {
        if (this.userPolicy.after_hours)
          this.userPolicy.after_hours.start_minute = parseMinute(value);
      },
    },
    afterHoursEnd: {
      get(): string {
        return this.userPolicy.after_hours
          ? formatMinute(this.userPolicy.after_hours.end_minute)
          : '';
      },
      set(value: string) {
        if (this.userPolicy.after_hours)
          this.userPolicy.after_hours.end_minute = parseMinute(value);
      },
    },
  },
  watch: {
    candidatePayload() {
      this.invalidateReviews();
    },
    destinationId() {
      this.invalidateReviews();
    },
    purposeId() {
      this.invalidateReviews();
    },
    userPolicy: {
      deep: true,
      handler() {
        this.invalidateReviews();
      },
    },
    signedPolicyJson() {
      this.invalidateReviews();
    },
  },
  mounted() {
    this.unregisterPolicyDraft = registerPolicyDraft(['egress.user_policy','egress.signed_bundle'], {
      blocked: () => this.hasPolicyChanges || !!this.signedPolicyJson.trim() || this.busy || this.loading,
      reload: async owned => { if (await owned() && !await this.refresh(owned)) throw new Error('Firewall policy could not be refreshed.'); },
    });
    this.refresh();
  },
  beforeDestroy() {
    this.unregisterPolicyDraft?.();
    this.disposed = true;
    this.invalidateReviews();
    this.candidatePayload = '{}';
    this.signedPolicyJson = '';
    this.userPolicy = emptyPolicy();
    this.savedPolicy = emptyPolicy();
    this.status = this.policy = null;
    this.receipts = this.approvals = [];
    this.destinationId = this.purposeId = this.error = '';
    this.busy = this.loading = false;
  },
  methods: {
    invalidateReviews() {
      this.reviewRevision++;
      this.preview = this.policyPreview = this.signedPolicyPreview = null;
      this.selectedApprovalId = '';
    },
    beginRequest() {
      if (this.disposed) return null;
      this.error = '';
      this.busy = this.loading = false;
      return { generation: ++this.requestGeneration, revision: this.reviewRevision };
    },
    isCurrent(request) {
      return !this.disposed && request.generation === this.requestGeneration &&
        request.revision === this.reviewRevision;
    },
    finishRequest(request) {
      if (!this.disposed && request.generation === this.requestGeneration)
        this.busy = this.loading = false;
    },
    async refresh(owned?: () => Promise<boolean>) {
      const guard = typeof owned === 'function' ? owned : null;
      this.invalidateReviews();
      const request = this.beginRequest();
      if (!request) return false;
      this.loading = !guard;
      try {
        const client = getClient().req;
        const [statusResponse, receipts, userPolicy, approvals] = await Promise.all([
          client.get('/0/egress/status'),
          client.get('/0/egress/receipts'),
          client.get('/0/egress/user-policy'),
          client.get('/0/egress/approvals'),
        ]);
        if (!this.isCurrent(request) || (guard && !await guard()) || !this.isCurrent(request)) return false;
        let policy = null;
        if (statusResponse.data.policy_bundle_stored && statusResponse.data.trusted_policy_keys) {
          const response = await client.get('/0/egress/policy');
          if (!this.isCurrent(request) || (guard && !await guard()) || !this.isCurrent(request)) return false;
          policy = response.data;
        }
        this.status = statusResponse.data;
        this.receipts = receipts.data;
        this.approvals = approvals.data;
        this.selectedApprovalId = '';
        this.userPolicy = copy(userPolicy.data);
        this.savedPolicy = copy(userPolicy.data);
        this.policy = policy;
        if (policy) {
          this.destinationId = this.destinations[0]?.id || '';
          this.selectPurpose();
        } else {
          this.destinationId = '';
          this.purposeId = '';
        }
        return true;
      } catch (_) {
        if (!this.isCurrent(request) || (guard && !await guard()) || !this.isCurrent(request)) return false;
        this.error =
          'Privacy Firewall status could not be loaded. Outbound requests remain blocked.';
        return false;
      } finally {
        this.finishRequest(request);
      }
    },
    async previewSignedPolicy() {
      const request = this.beginRequest();
      if (!request) return;
      this.signedPolicyPreview = null;
      let bundle;
      try {
        bundle = JSON.parse(this.signedPolicyJson);
      } catch (_) {
        this.error = 'Signed policy bundle must be valid JSON.';
        return;
      }
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        this.error = 'Signed policy bundle must be a JSON object.';
        return;
      }
      this.busy = true;
      try {
        const { data: diff } = await getClient().req.post('/0/egress/policy/diff', bundle);
        if (!this.isCurrent(request)) return;
        this.signedPolicyPreview = { bundle, diff };
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error = 'Signed policy could not be verified. No policy was changed.';
      } finally {
        this.finishRequest(request);
      }
    },
    async acceptSignedPolicy() {
      if (!this.signedPolicyPreview) return;
      const reviewed = this.signedPolicyPreview;
      const payload = copy({ accept: true, bundle: reviewed.bundle, expected_diff: reviewed.diff });
      const request = this.beginRequest();
      if (!request) return;
      this.busy = true;
      try {
        await getClient().req.put('/0/egress/policy/accept', payload);
        if (!this.isCurrent(request) || this.signedPolicyPreview !== reviewed) return;
        this.signedPolicyJson = '';
        this.signedPolicyPreview = null;
        await this.$nextTick();
        if (this.disposed || request.generation !== this.requestGeneration || this.signedPolicyJson)
          return;
        await this.refresh();
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error = 'Signed policy was not accepted. Review the current diff and try again.';
      } finally {
        this.finishRequest(request);
      }
    },
    selectPurpose() {
      this.preview = null;
      this.purposeId = this.purposes[0]?.id || '';
    },
    async previewCandidate() {
      const request = this.beginRequest();
      if (!request) return;
      this.preview = null;
      let payload;
      try {
        payload = JSON.parse(this.candidatePayload);
      } catch (_) {
        this.error = 'Candidate request payload must be valid JSON.';
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        this.error = 'Candidate request payload must be a JSON object.';
        return;
      }
      const purpose = this.purposes.find(item => item.id === this.purposeId);
      if (!purpose) return;
      this.busy = true;
      try {
        const { data } = await getClient().req.post('/0/egress/preview', {
          schema_version: 1,
          destination_id: this.destinationId,
          purpose_id: purpose.id,
          retention_id: purpose.retention_id,
          payload,
        });
        if (!this.isCurrent(request)) return;
        this.preview = data;
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error = 'The request could not be previewed. Outbound requests remain blocked.';
      } finally {
        this.finishRequest(request);
      }
    },
    async sendPreview() {
      if (
        !this.preview ||
        this.preview.decision.outcome !== 'allow' ||
        !this.status?.outbound_enabled
      )
        return;
      const reviewed = this.preview;
      const previewId = reviewed.decision.preview_id;
      const scope = this.approvalScope;
      const selectedApprovalId = this.selectedApprovalId;
      const selectionRevision = this.approvalSelectionRevision;
      const request = this.beginRequest();
      if (!request) return;
      const current = () => this.isCurrent(request) && this.preview === reviewed &&
        this.approvalSelectionRevision === selectionRevision &&
        this.approvalScope === scope && this.selectedApprovalId === selectedApprovalId;
      this.busy = true;
      try {
        let approvalId = selectedApprovalId;
        if (!approvalId) {
          const expiresAt =
            scope === 'destination_specific'
              ? null
              : new Date(
                  Date.now() + (scope === 'once' ? 5 : 60) * 60 * 1000
                ).toISOString();
          const { data } = await getClient().req.post('/0/egress/approve', {
            preview_id: previewId,
            scope,
            expires_at: expiresAt,
          });
          approvalId = data.approval_id;
        }
        if (!current()) return;
        await getClient().req.post('/0/egress/send', {
          preview_id: previewId,
          approval_id: approvalId,
        });
        if (!current()) return;
        this.selectedApprovalId = '';
        this.preview = null;
        await this.refresh();
      } catch (_) {
        if (!current()) return;
        this.preview = null;
        this.selectedApprovalId = '';
        try {
          const { data } = await getClient().req.get('/0/egress/approvals');
          if (!this.isCurrent(request)) return;
          this.approvals = data;
        } catch {
          if (!this.isCurrent(request)) return;
          this.approvals = [];
        }
        this.error =
          'The approved request was not sent. Review the latest policy and preview again.';
      } finally {
        this.finishRequest(request);
      }
    },
    async revokeApprovals() {
      if (!this.approvals.length) return;
      this.invalidateReviews();
      const request = this.beginRequest();
      if (!request) return;
      this.busy = true;
      try {
        await getClient().req.delete('/0/egress/approvals');
        if (!this.isCurrent(request)) return;
        this.selectedApprovalId = '';
        await this.refresh();
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error = 'Active outbound approvals could not be revoked.';
      } finally {
        this.finishRequest(request);
      }
    },
    addRule() {
      this.userPolicy.user_rules.push({ pattern: { kind: 'keyword', value: '' }, action: 'deny' });
    },
    addPasswordManagerPreset() {
      const rule = { pattern: { kind: 'application', value: 'password' }, action: 'deny' };
      if (!this.userPolicy.user_rules.some(existing => same(existing, rule)))
        this.userPolicy.user_rules.push(rule);
    },
    addSensitiveActivityPreset() {
      for (const value of ['medical', 'banking', 'payroll']) {
        const rule = { pattern: { kind: 'keyword', value }, action: 'deny' };
        if (!this.userPolicy.user_rules.some(existing => same(existing, rule)))
          this.userPolicy.user_rules.push(rule);
      }
    },
    addSafeZonePattern() {
      this.userPolicy.safe_zone_patterns.push({ kind: 'application', value: '' });
    },
    sameSchedule(before, after) {
      return same(before, after);
    },
    async previewUserPolicy() {
      const request = this.beginRequest();
      if (!request) return;
      const draft = copy(this.userPolicy);
      this.busy = true;
      this.policyPreview = null;
      try {
        const { data } = await getClient().req.post(
          '/0/egress/user-policy/diff',
          draft
        );
        if (!this.isCurrent(request)) return;
        this.policyPreview = data;
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error =
          'Local privacy changes could not be reviewed. Check the rule values and try again.';
      } finally {
        this.finishRequest(request);
      }
    },
    async acceptUserPolicy() {
      if (!this.policyPreview) return;
      const reviewed = this.policyPreview;
      const previewId = reviewed.preview_id;
      const request = this.beginRequest();
      if (!request) return;
      this.busy = true;
      try {
        await getClient().req.put('/0/egress/user-policy/accept', {
          preview_id: previewId,
        });
        if (!this.isCurrent(request) || this.policyPreview !== reviewed) return;
        this.policyPreview = null;
        await this.refresh();
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error =
          'Local privacy changes were not saved. Review the latest policy and try again.';
      } finally {
        this.finishRequest(request);
      }
    },
    async toggleKillSwitch() {
      if (!this.status) return;
      const enabled = !this.status.kill_switch_enabled;
      this.invalidateReviews();
      const request = this.beginRequest();
      if (!request) return;
      this.busy = true;
      try {
        await getClient().req.post('/0/egress/kill-switch', {
          enabled,
        });
        if (!this.isCurrent(request)) return;
        await this.refresh();
      } catch (_) {
        if (!this.isCurrent(request)) return;
        this.error = 'The outbound kill switch could not be changed.';
      } finally {
        this.finishRequest(request);
      }
    },
  },
};
</script>
