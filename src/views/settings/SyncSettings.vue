<template lang="pug">
div.sync-settings
  b-alert(variant="warning" show)
    strong End-to-end sync is {{ capabilityStatus }}.
    |  Pairing and encrypted key handoff use manual JSON exchange. Network sync stays off until the capability and a signed relay are available.

  b-alert(v-if="store.error" variant="danger" show) {{ store.error }}

  SyncPolicyReview(:active="active")

  section.mb-4
    h5 Network sync
    p(v-if="store.syncPreparing") The encrypted local baseline is {{ store.baselineProgress?.baseline_cursor || 0 }} / {{ store.baselineProgress?.baseline_max_event_id || 0 }} events complete. No relay requests are made until this step finishes.
    p(v-if="store.syncEnabled") Relay sync is enabled for the signed destination shown by local consent.
    p.text-muted(v-else-if="!store.syncPreparing") Relay sync is off. Starting requires a trusted signed destination, a confirmed recovery kit, a current paired device, and the Privacy Firewall enabled.
    p.small.text-muted Stop sync pauses relay transfer and retains the encrypted operation queue for a later resume.
    p.small.text-muted(v-if="syncUnavailableReason") {{ syncUnavailableReason }}
    b-button(variant="outline-secondary" :disabled="store.busy" @click="store.refreshSyncControl()") Refresh sync status
    b-button.ml-2(
      v-if="store.syncPreparing"
      variant="primary"
      :disabled="store.busy || !!syncUnavailableReason"
      @click="store.setSyncEnabled(true)"
    ) Continue sync preparation
    b-button.ml-2(
      v-if="store.syncEnabled || store.syncPreparing"
      variant="outline-danger"
      :disabled="store.busy || !store.syncControlAvailable"
      @click="store.setSyncEnabled(false)"
    ) Stop sync
    b-button.ml-2(
      v-if="!store.syncEnabled && !store.syncPreparing"
      variant="primary"
      :disabled="store.busy || !!syncUnavailableReason"
      @click="store.setSyncEnabled(true)"
    ) Start sync
    h6.mt-3 Deletion acknowledgements
    b-button(variant="outline-secondary" size="sm" :disabled="store.busy" @click="store.refreshTombstoneStatuses()") Refresh tombstone status
    p.text-muted(v-if="!store.pendingTombstones.length") No tombstones are present in the locally stored current-key sync manifests.
    ul(v-else)
      li(v-for="tombstone in store.pendingTombstones" :key="`${tombstone.origin_device_id}-${tombstone.local_event_id}-${tombstone.tombstone_counter}`")
        | Tombstone {{ tombstone.origin_device_id }} / {{ tombstone.local_event_id }} / {{ tombstone.tombstone_counter }}:
        span(v-if="tombstone.pending_device_ids.length") Waiting for {{ tombstone.pending_device_ids.join(', ') }}
        span(v-else-if="tombstone.active_device_ids.length") acknowledged by all active devices
        span(v-else) no active paired devices to acknowledge

  section.mb-4
    h5 This device
    b-button(variant="outline-secondary" :disabled="store.busy" @click="store.refresh()") Refresh device identity
    b-button.ml-2(variant="outline-primary" :disabled="store.busy" @click="store.createLocalIdentity()") Create local identity
    p.text-muted.mt-2(v-if="store.devices.length === 0") No sync identity has been created on this device.
    dl.mt-2(v-for="device in store.devices" :key="device.device_id")
      dt Device ID
      dd.font-monospace {{ device.device_id }}
      dt X25519 public key
      dd.font-monospace {{ device.x25519_public_key }}
      dt(v-if="device.ed25519_public_key") Ed25519 signing public key
      dd.font-monospace(v-if="device.ed25519_public_key") {{ device.ed25519_public_key }}
      dt Pairing status
      dd {{ device.is_current_device ? 'This device' : (device.revoked_at ? 'Revoked' : (device.needs_repair ? 'Re-pair required' : 'Verified')) }}
      dt(v-if="device.paired_at") Paired at
      dd(v-if="device.paired_at") {{ device.paired_at }}
      b-button.mt-2(
        v-if="!device.is_current_device && !device.revoked_at"
        size="sm"
        variant="outline-danger"
        :disabled="store.busy"
        @click="confirmRevoke(device.device_id)"
      ) Revoke device
    p.small.text-muted Revocation rotates the account root and vault key. Other paired devices must be verified again. Keys or ciphertext already copied by the lost device cannot be recalled.
    b-button.mt-2(
      variant="outline-warning"
      :disabled="store.busy"
      @click="rotateKeys"
    ) Rotate sync keys
    p.small.text-muted Rotating invalidates the saved recovery kit and requires every other device to pair again.
    h6.mt-3 Recent access history
    ul(v-if="store.accessHistory.length")
      li(v-for="(event, index) in store.accessHistory" :key="`${event.device_id}-${event.action}-${index}`") {{ event.action }} · {{ event.device_id }} · {{ event.occurred_at }}
    p.text-muted(v-else) No paired-device access events.

  section.mb-4
    h5 Start a pairing
    b-form-group(label="Other device public identity (JSON)")
      b-form-textarea(v-model="recipientIdentity" rows="3" :disabled="store.busy")
    b-button(variant="primary" :disabled="store.busy || !recipientIdentity" @click="store.createPairing(recipientIdentity)") Create invitation
    b-form-group.mt-3(label="Invitation to copy to the other device" v-if="store.invitation")
      b-form-textarea(:value="store.invitation" rows="5" readonly)
    b-form-group.mt-3(label="Paste the other device response")
      b-form-textarea(v-model="responseInput" rows="4" :disabled="store.busy")
    b-button(variant="outline-primary" :disabled="store.busy || !responseInput" @click="store.completePairing(responseInput)") Complete offer and show code

  section.mb-4
    h5 Respond to an invitation
    b-form-group(label="Paste invitation JSON")
      b-form-textarea(v-model="invitationInput" rows="5" :disabled="store.busy")
    b-button(variant="outline-primary" :disabled="store.busy || !invitationInput" @click="store.respondToPairing(invitationInput)") Create response
    b-form-group.mt-3(label="Response to copy to the initiating device" v-if="store.response")
      b-form-textarea(:value="store.response" rows="4" readonly)
    b-form-group.mt-3(label="Paste the completed offer")
      b-form-textarea(v-model="offerInput" rows="6" :disabled="store.busy")
    b-button(variant="outline-primary" :disabled="store.busy || !offerInput" @click="store.preparePairing(offerInput)") Show verification code

  section.mb-4(v-if="store.verificationCode")
    h5 Compare both screens
    p The code must match on both devices before either user confirms.
    p.sync-settings__code(aria-label="Pairing verification code") {{ store.verificationCode }}
    b-form-group(label="Code shown on the other device")
      b-form-input(v-model="displayedCode" inputmode="numeric" maxlength="8" :disabled="store.busy")
    b-form-checkbox(v-model="userConfirmed" :disabled="store.busy") I compared the code on both devices.
    b-button.mt-2(variant="primary" :disabled="store.busy || !userConfirmed || !displayedCode" @click="store.confirmPairing(displayedCode, true)") Confirm this code
    b-form-group.mt-3(label="Confirmation message to copy to the other device" v-if="store.confirmation")
      b-form-textarea(:value="store.confirmation" rows="4" readonly)

  section.mb-4(v-if="store.confirmation")
    h5 Peer confirmation
    b-form-group(label="Paste the other device confirmation")
      b-form-textarea(v-model="store.peerConfirmationInput" rows="4" :disabled="store.busy")

  section.mb-4(v-if="store.confirmation")
    h5 Send encrypted key handoff
    b-button(variant="primary" :disabled="store.busy || !store.peerConfirmationInput" @click="store.createKeyTransfer(store.peerConfirmationInput)") Create encrypted handoff
    b-form-group.mt-3(label="Encrypted handoff to copy to the responding device" v-if="store.keyTransfer")
      b-form-textarea(:value="store.keyTransfer" rows="5" readonly)

  section.mb-4(v-if="store.confirmation")
    h5 Accept encrypted key handoff
    b-form-group(label="Paste encrypted handoff JSON")
      b-form-textarea(v-model="keyTransferInput" rows="5" :disabled="store.busy")
    b-button(variant="outline-primary" :disabled="store.busy || !store.peerConfirmationInput || !keyTransferInput" @click="store.acceptKeyTransfer(store.peerConfirmationInput, keyTransferInput)") Accept encrypted handoff
    p.text-success.mt-2(v-if="store.pairedPeer") Key handoff accepted from device {{ store.pairedPeer.device_id }}.

  section.mb-4
    h5 Offline recovery
    p.text-muted The recovery kit protects sync keys. Pair it with an encrypted activity snapshot to restore history on a clean device.
    SyncBackupCatalogue(:active="active")
    p(v-if="store.recoveryConfirmed") A recovery phrase has been confirmed for this vault.
    p(v-else) No recovery phrase has been confirmed.
    b-button(
      variant="outline-primary"
      :disabled="store.busy || store.recoveryConfirmed || !!store.recoveryPhrase"
      @click="store.createRecoveryKit()"
    ) Create one-time recovery kit
    b-form-group.mt-3(label="One-time recovery phrase — save it privately" v-if="store.recoveryPhrase")
      b-form-input(:value="store.recoveryPhrase" readonly)
    b-form-group(label="Encrypted recovery kit — save this file/text too" v-if="store.recoveryKit")
      b-form-textarea(:value="store.recoveryKit" rows="5" readonly)
    b-form-checkbox(
      v-if="store.recoveryPhrase"
      v-model="recoverySaved"
      :disabled="store.busy"
    ) I saved the phrase and encrypted kit.
    b-button.mt-2(
      v-if="store.recoveryPhrase"
      variant="primary"
      :disabled="store.busy || !recoverySaved"
      @click="confirmRecoverySaved"
    ) Confirm recovery saved
    b-button.ml-2(
      v-if="store.recoveryPhrase"
      variant="outline-secondary"
      :disabled="store.busy"
      @click="store.cancelRecoveryKit()"
    ) Cancel and clear phrase
    b-form-group.mt-4(label="Verify or restore a saved sync-key kit")
      b-form-textarea(v-model="recoveryKitInput" rows="5" :disabled="store.busy" @input="clearRestorePreview")
    b-form-group(label="Encrypted activity snapshot JSON")
      b-form-textarea(v-model="snapshotInput" rows="6" :disabled="store.busy" @input="clearRestorePreview")
    b-form-group(label="Recovery phrase")
      b-form-input(v-model="store.recoveryPhraseInput" type="password" autocomplete="off" :disabled="store.busy" @input="clearRestorePreview")
    p.small.text-muted Restore requires an empty activity vault with recording paused.
    b-button(variant="outline-primary" :disabled="store.busy || !recoveryKitInput || !store.recoveryPhraseInput" @click="store.verifyRecoveryKit(recoveryKitInput, store.recoveryPhraseInput)") Verify kit
    b-button.ml-2(variant="outline-primary" :disabled="store.busy || !recoveryKitInput || !store.recoveryPhraseInput || !snapshotInput" @click="previewRecoveryRestore") Preview restore
    section.mt-3(v-if="store.restorePreview" aria-label="Encrypted restore preview")
      h6 Restore preview — encrypted data only
      p No activity event contents are shown. Restore will write only after you accept this preview.
      p(v-if="store.restorePreview.policy_continuity_present") {{ store.restorePreview.policy_conflict_count }} settings or policy fields need local review. Current settings stay active until you explicitly accept each change.
      p.text-warning(v-else) Portable active settings are absent from this legacy snapshot. Its stored operation history is retained.
      dl
        dt Device ID
        dd.font-monospace {{ store.restorePreview.device_id || 'Not available in this local vault' }}
        dt Vault ID
        dd.font-monospace {{ store.restorePreview.vault_id }}
        dt Schema / key epoch
        dd {{ store.restorePreview.schema_version }} / {{ store.restorePreview.key_epoch }}
        dt Snapshot version range
        dd.font-monospace {{ store.restorePreview.version_start }} → {{ store.restorePreview.version_end }}
        dt Ciphertext object count
        dd {{ store.restorePreview.object_count }}
        dt Tombstones / policy conflicts
        dd {{ store.restorePreview.tombstone_count }} / {{ store.restorePreview.policy_conflict_count }}
        dt Query range
        dd {{ store.restorePreview.query_start || 'No events' }} → {{ store.restorePreview.query_end || 'No events' }}
      b-form-checkbox(v-model="store.restoreAccepted" :disabled="store.busy") I reviewed this metadata and accept restoring it to this empty vault.
      b-button.mt-2(variant="danger" :disabled="store.busy || !store.restoreAccepted" @click="restoreRecoveryKit") Restore encrypted activity
    p.small.text-muted.mt-2(v-if="store.recoveryPreview") Verified vault {{ store.recoveryPreview.vault_id }}, key epoch {{ store.recoveryPreview.key_epoch }}.
    b-form-checkbox.mt-2(v-if="store.recoveryRestored && !store.recoveryConfirmed" v-model="recoverySaved" :disabled="store.busy") I saved the recovery phrase and encrypted kit.
    b-button.mt-2(v-if="store.recoveryRestored && !store.recoveryConfirmed" variant="primary" :disabled="store.busy || !recoverySaved" @click="confirmRecoverySaved") Confirm recovery saved

  b-button(variant="outline-secondary" :disabled="store.busy" @click="cancel") Cancel pairing
</template>

<script lang="ts">
import { useSyncStore } from '~/stores/sync';
import { useBackupStore } from '~/stores/backups';
import SyncPolicyReview from '~/components/SyncPolicyReview.vue';
import SyncBackupCatalogue from '~/components/SyncBackupCatalogue.vue';
import experience from '~/generated/product-experience.json';
import { capability } from '~/product/experience';

export default {
  name: 'SyncSettings',
  components: { SyncPolicyReview, SyncBackupCatalogue },
  props: { active: { type: Boolean, default: true } },
  data() {
    return {
      store: useSyncStore(),
      backups: useBackupStore(),
      recipientIdentity: '',
      invitationInput: '',
      responseInput: '',
      offerInput: '',
      displayedCode: '',
      userConfirmed: false,
      keyTransferInput: '',
      recoverySaved: false,
      recoveryKitInput: '',
      snapshotInput: '',
    };
  },
  computed: {
    capabilityStatus(): string {
      return capability('e2ee-sync', experience)?.status || 'Unavailable';
    },
    syncUnavailableReason(): string {
      if (!['Available', 'Beta', 'Experimental'].includes(this.capabilityStatus))
        return `Network sync is local-only while this capability is ${this.capabilityStatus}.`;
      if (!this.store.vaultReady) return 'Unlock the encrypted vault to use sync.';
      if (!this.store.syncControlAvailable) return 'The local sync control API is unavailable.';
      if (this.store.killSwitchEnabled) return 'The Privacy Firewall kill switch is on.';
      if (!this.store.egressEnabled) return 'A trusted Privacy Firewall policy is required.';
      if (!this.store.syncDestinationAvailable) return 'No signed sync destination is configured.';
      if (!this.store.recoveryConfirmed) return 'Save and confirm a recovery kit first.';
      if (!this.store.devices.some(device => !device.is_current_device && !device.revoked_at && !device.needs_repair))
        return 'Pair and verify another current-epoch device first.';
      return '';
    },
  },
  watch: {
    'backups.restored'(value: boolean) {
      if (!value) return;
      this.store.clearSensitive();
      this.store.recoveryConfirmed = false;
      this.store.recoveryRestored = true;
      this.recoverySaved = false;
      this.recoveryKitInput = this.snapshotInput = '';
      void this.store.refresh();
      void this.store.refreshSyncControl();
    },
  },
  created() {
    this.store.refresh();
    this.store.refreshAccessHistory();
    this.store.refreshTombstoneStatuses();
    this.store.refreshRecoveryConfirmation();
    this.store.refreshSyncControl();
  },
  beforeDestroy() {
    void this.store.cancelPairing();
    void this.store.cancelRecoveryKit();
    this.store.clearSensitive();
  },
  methods: {
    async cancel() {
      await this.store.cancelPairing();
      this.recipientIdentity = '';
      this.invitationInput = '';
      this.responseInput = '';
      this.offerInput = '';
      this.displayedCode = '';
      this.userConfirmed = false;
      this.store.peerConfirmationInput = '';
      this.keyTransferInput = '';
    },
    async confirmRecoverySaved() {
      await this.store.confirmRecoverySaved(true);
      if (this.store.recoveryConfirmed) this.recoverySaved = false;
    },
    async restoreRecoveryKit() {
      await this.store.acceptRecoveryRestore(
        this.recoveryKitInput,
        this.store.recoveryPhraseInput,
        this.snapshotInput,
        this.store.restoreAccepted
      );
      if (this.store.recoveryRestored) this.recoverySaved = false;
    },
    async previewRecoveryRestore() {
      await this.store.previewRecoveryRestore(
        this.recoveryKitInput,
        this.store.recoveryPhraseInput,
        this.snapshotInput
      );
    },
    clearRestorePreview() {
      this.store.invalidateRestorePreview();
    },
    async rotateKeys() {
      if (
        !window.confirm(
          'Rotate the account root and vault key? The saved recovery kit will stop working, and every other device must be paired again.'
        )
      ) {
        return;
      }
      await this.store.rotateKeys();
    },
    async confirmRevoke(deviceId: string) {
      if (
        !window.confirm(
          'Revoke this device and rotate sync keys? Other devices must be paired again.'
        )
      ) {
        return;
      }
      await this.store.revokeDevice(deviceId);
    },
  },
};
</script>

<style scoped lang="scss">
.sync-settings__code {
  font-family: monospace;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.15em;
}
</style>
