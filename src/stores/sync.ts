import { defineStore } from 'pinia';
import { getClient, invokeAndroidNative } from '~/util/awclient';
import { useBackupStore } from '~/stores/backups';

const SYNC_PURPOSE_ID = 'sync-object-v1';

export interface SyncRestorePreview {
  schema_version: number;
  device_id?: string | null;
  vault_id: string;
  key_epoch: number;
  snapshot_id: string;
  object_count: number;
  version_start: string | null;
  version_end: string | null;
  tombstone_count: number;
  query_start: string | null;
  query_end: string | null;
  policy_conflict_count: number;
  policy_continuity_present: boolean;
}

export interface DevicePublicIdentity {
  schema_version: 1;
  device_id: string;
  x25519_public_key: string;
  ed25519_public_key?: string;
}

export interface SyncDeviceSummary extends DevicePublicIdentity {
  is_current_device: boolean;
  needs_repair?: boolean;
  paired_at?: string | null;
  revoked_at?: string | null;
}

export interface SyncDeviceAccessEvent {
  device_id: string;
  action: 'paired' | 'revoked';
  occurred_at: string;
}

export interface SyncTombstoneStatus {
  origin_device_id: string;
  local_event_id: number;
  tombstone_counter: number;
  active_device_ids: string[];
  pending_device_ids: string[];
}

export interface SyncBaselineProgress {
  key_epoch: number;
  baseline_max_event_id: number;
  baseline_cursor: number;
  complete: boolean;
}

export interface SyncBaselineProgress {
  key_epoch: number;
  baseline_max_event_id: number;
  baseline_cursor: number;
  complete: boolean;
}

type JsonObject = Record<string, unknown>;

async function native(command: string, args?: object): Promise<any> {
  if ((window as unknown as { Android?: unknown }).Android) {
    return invokeAndroidNative(command, args);
  }
  const bridge = (
    window as unknown as {
      __TAURI__?: {
        core: {
          invoke: (commandName: string, invocationArgs?: object) => Promise<any>;
        };
      };
    }
  ).__TAURI__;
  if (!bridge) throw new Error('Open this control in PeakActivity.');
  return args === undefined ? bridge.core.invoke(command) : bridge.core.invoke(command, args);
}

function parseJson(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Paste a JSON object.');
  }
  return parsed as JsonObject;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSyncStore = defineStore('sync', {
  state: () => ({
    devices: [] as SyncDeviceSummary[],
    vaultReady: false,
    accessHistory: [] as SyncDeviceAccessEvent[],
    pendingTombstones: [] as SyncTombstoneStatus[],
    invitation: '',
    response: '',
    offer: '',
    verificationCode: '',
    confirmation: '',
    keyTransfer: '',
    peerConfirmationInput: '',
    pairedPeer: null as SyncDeviceSummary | null,
    recoveryPhrase: '',
    recoveryPhraseInput: '',
    recoveryKit: '',
    recoveryConfirmed: false,
    recoveryRestored: false,
    recoveryPreview: null as { vault_id: string; key_epoch: number } | null,
    restorePreview: null as SyncRestorePreview | null,
    restoreAccepted: false,
    snapshotExport: '',
    syncEnabled: false,
    syncPreparing: false,
    baselineProgress: null as SyncBaselineProgress | null,
    syncControlAvailable: false,
    egressEnabled: false,
    killSwitchEnabled: true,
    syncDestinationAvailable: false,
    error: '',
    busy: false,
    operation: 0,
  }),
  actions: {
    async run(command: string, args?: object): Promise<any | null> {
      if (['rotate_sync_keys', 'revoke_sync_device', 'accept_sync_key_transfer', 'restore_sync_recovery_kit', 'create_sync_recovery_kit', 'create_current_sync_snapshot'].includes(command)) useBackupStore().clearSensitive();
      const operation = ++this.operation;
      this.busy = true;
      this.error = '';
      try {
        return await native(command, args);
      } catch (error) {
        if (operation === this.operation) this.error = errorMessage(error);
        return null;
      } finally {
        if (operation === this.operation) this.busy = false;
      }
    },
    async refresh() {
      const devices = await this.run('list_sync_devices');
      if (Array.isArray(devices)) {
        this.devices = devices;
        this.vaultReady = true;
      } else {
        this.vaultReady = false;
      }
    },
    async refreshAccessHistory() {
      const events = await this.run('list_sync_device_access_history');
      if (Array.isArray(events)) this.accessHistory = events;
    },
    async refreshTombstoneStatuses() {
      const statuses = await this.run('list_sync_tombstone_statuses');
      this.pendingTombstones = Array.isArray(statuses) ? statuses : [];
    },
    async refreshRecoveryConfirmation() {
      const confirmed = await this.run('sync_recovery_confirmed');
      if (typeof confirmed === 'boolean') this.recoveryConfirmed = confirmed;
    },
    async refreshSyncControl() {
      try {
        const client = getClient().req;
        const [control, status] = await Promise.all([
          client.get('/0/sync/enabled'),
          client.get('/0/egress/status'),
        ]);
        this.syncEnabled = control.data.enabled === true;
        this.syncPreparing = control.data.preparing === true;
        this.baselineProgress = control.data.baseline || null;
        this.syncControlAvailable = true;
        this.egressEnabled = status.data.outbound_enabled === true;
        this.killSwitchEnabled = status.data.kill_switch_enabled !== false;
        this.syncDestinationAvailable = false;
        if (status.data.policy_bundle_stored && status.data.trusted_policy_keys > 0) {
          const { data: policy } = await client.get('/0/egress/policy');
          this.syncDestinationAvailable = (policy.purposes || []).some(
            (purpose: any) =>
              purpose.id === SYNC_PURPOSE_ID &&
              (policy.destinations || []).some(
                (destination: any) =>
                  destination.id === purpose.destination_id &&
                  ['available', 'beta', 'experimental'].includes(destination.status)
              )
          );
        }
        this.error = '';
      } catch (error) {
        this.syncControlAvailable = false;
        this.syncEnabled = false;
        this.syncPreparing = false;
        this.baselineProgress = null;
        this.syncDestinationAvailable = false;
        this.error = errorMessage(error);
      }
    },
    async setSyncEnabled(enabled: boolean) {
      const operation = ++this.operation;
      this.busy = true;
      this.error = '';
      try {
        const client = getClient().req;
        let request: Record<string, unknown> = { enabled };
        if (enabled) {
          const { data: status } = await client.get('/0/egress/status');
          if (!status.outbound_enabled || status.kill_switch_enabled) {
            throw new Error('Sync is blocked by the Privacy Firewall or its kill switch.');
          }
          const { data: policy } = await client.get('/0/egress/policy');
          const purpose = (policy.purposes || []).find(
            (item: any) => item.id === SYNC_PURPOSE_ID
          );
          const destination = (policy.destinations || []).find(
            (item: any) =>
              item.id === purpose?.destination_id &&
              ['available', 'beta', 'experimental'].includes(item.status)
          );
          if (!purpose || !destination) {
            throw new Error('No trusted signed sync destination is configured.');
          }
          request = {
            enabled: true,
            destination_id: destination.id,
            purpose_id: SYNC_PURPOSE_ID,
          };
          if (!this.syncPreparing) {
            useBackupStore().clearSensitive();
            await native('create_current_sync_snapshot');
          }
        }
        const { data } = await client.post('/0/sync/enabled', request);
        if (operation === this.operation) {
          this.syncEnabled = data.enabled === true;
          this.syncPreparing = data.preparing === true;
          if (data.baseline) this.baselineProgress = data.baseline;
          this.syncControlAvailable = true;
        }
      } catch (error) {
        if (operation === this.operation) this.error = errorMessage(error);
      } finally {
        if (operation === this.operation) this.busy = false;
      }
    },
    async createLocalIdentity() {
      const identity = await this.run('create_local_sync_identity');
      if (identity && !this.devices.some(device => device.device_id === identity.device_id)) {
        this.devices = [...this.devices, { ...identity, is_current_device: true }];
      }
    },
    async createPairing(publicIdentityJson: string) {
      try {
        const recipient = parseJson(publicIdentityJson);
        const invitation = await this.run('create_sync_pairing', { recipient });
        if (invitation) this.invitation = JSON.stringify(invitation, null, 2);
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async respondToPairing(invitationJson: string) {
      try {
        const invitation = parseJson(invitationJson);
        const response = await this.run('respond_sync_pairing', { invitation });
        if (response) this.response = JSON.stringify(response, null, 2);
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async completePairing(responseJson: string) {
      try {
        const response = parseJson(responseJson);
        const display = await this.run('complete_sync_pairing', { response });
        if (display) {
          this.offer = JSON.stringify(display.offer, null, 2);
          this.verificationCode = display.verification_code;
        }
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async preparePairing(offerJson: string) {
      try {
        const offer = parseJson(offerJson);
        const code = await this.run('prepare_sync_pairing', { offer });
        if (typeof code === 'string') {
          this.offer = JSON.stringify(offer, null, 2);
          this.verificationCode = code;
        }
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async confirmPairing(displayedCode: string, userConfirmed: boolean) {
      const confirmation = await this.run('confirm_sync_pairing', {
        displayedCode,
        userConfirmed,
      });
      if (confirmation) this.confirmation = JSON.stringify(confirmation, null, 2);
    },
    async createKeyTransfer(peerConfirmationJson: string) {
      try {
        const peerConfirmation = parseJson(peerConfirmationJson);
        const transfer = await this.run('create_sync_key_transfer', { peerConfirmation });
        if (transfer) {
          this.keyTransfer = JSON.stringify(transfer, null, 2);
          await this.refresh();
          await this.refreshAccessHistory();
          await this.refreshSyncControl();
          await this.refreshTombstoneStatuses();
        }
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async acceptKeyTransfer(peerConfirmationJson: string, transferJson: string) {
      try {
        const peerConfirmation = parseJson(peerConfirmationJson);
        const transfer = parseJson(transferJson);
        const peer = await this.run('accept_sync_key_transfer', { peerConfirmation, transfer });
        if (peer) {
          this.pairedPeer = { ...peer, is_current_device: false };
          await this.refresh();
          await this.refreshAccessHistory();
          await this.refreshSyncControl();
          await this.refreshTombstoneStatuses();
        }
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async revokeDevice(deviceId: string) {
      const revoked = await this.run('revoke_sync_device', { deviceId });
      if (revoked) {
        this.recoveryConfirmed = false;
        await this.refresh();
        await this.refreshAccessHistory();
        await this.refreshSyncControl();
        await this.refreshTombstoneStatuses();
      }
    },
    async rotateKeys() {
      const epoch = await this.run('rotate_sync_keys');
      if (typeof epoch === 'number') {
        this.recoveryConfirmed = false;
        await this.refresh();
        await this.refreshSyncControl();
        await this.refreshTombstoneStatuses();
      }
    },
    async createRecoveryKit() {
      if (this.recoveryPhrase) {
        this.error = 'Save or cancel the current one-time recovery phrase first.';
        return;
      }
      if (this.recoveryConfirmed) {
        this.error = 'A recovery phrase is already saved; rotate sync keys before replacing it.';
        return;
      }
      const recovery = await this.run('create_sync_recovery_kit');
      if (recovery) {
        this.recoveryPhrase = recovery.recovery_phrase;
        this.recoveryKit = JSON.stringify(recovery.kit, null, 2);
        this.recoveryConfirmed = false;
        this.recoveryPreview = null;
      }
    },
    async verifyRecoveryKit(kitJson: string, phrase: string) {
      try {
        const kit = parseJson(kitJson);
        const preview = await this.run('verify_sync_recovery_kit', {
          kit,
          recoveryPhrase: phrase,
        });
        if (preview) this.recoveryPreview = preview;
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async previewRecoveryRestore(kitJson: string, phrase: string, snapshotJson: string) {
      this.invalidateRestorePreview();
      const operation = this.operation + 1;
      try {
        const kit = parseJson(kitJson);
        const snapshot = parseJson(snapshotJson);
        const preview = await this.run('preview_sync_recovery_restore', {
          kit,
          recoveryPhrase: phrase,
          snapshot,
        });
        if (operation !== this.operation) return;
        if (preview) {
          if (typeof preview.policy_continuity_present !== 'boolean' || !Number.isInteger(preview.policy_conflict_count) || preview.policy_conflict_count < 0 || preview.policy_conflict_count > 21)
            throw new Error('The recovery policy metadata could not be verified.');
          this.restorePreview = preview;
          this.restoreAccepted = false;
        }
      } catch (error) {
        if (operation === this.operation) this.error = errorMessage(error);
      }
    },
    invalidateRestorePreview() {
      this.operation++;
      this.busy=false;
      this.restorePreview=null;
      this.restoreAccepted=false;
    },
    async acceptRecoveryRestore(
      kitJson: string,
      phrase: string,
      snapshotJson: string,
      userAccepted: boolean
    ) {
      if (!this.restorePreview || !userAccepted) return;
      const reviewed = this.restorePreview;
      const operation = this.operation + 1;
      try {
        const kit = parseJson(kitJson);
        const snapshot = parseJson(snapshotJson);
        if (snapshot.snapshot_id !== reviewed.snapshot_id) throw new Error('The recovery snapshot changed. Preview it again before restoring.');
        const preview = await this.run('restore_sync_recovery_kit', {
          kit,
          recoveryPhrase: phrase,
          snapshot,
          userAccepted,
        });
        if (operation !== this.operation) return;
        if (preview) {
          this.recoveryPreview = preview;
          this.recoveryPhrase = '';
          this.recoveryPhraseInput = '';
          this.recoveryConfirmed = false;
          this.recoveryRestored = true;
          this.restorePreview = null;
          this.restoreAccepted = false;
          await this.refresh();
        }
      } catch (error) {
        this.error = errorMessage(error);
      }
    },
    async confirmRecoverySaved(userConfirmed: boolean) {
      await this.run('confirm_sync_recovery_saved', { userConfirmed });
      if (userConfirmed && !this.error) {
        this.recoveryPhrase = '';
        this.recoveryPhraseInput = '';
        this.recoveryConfirmed = true;
        this.recoveryRestored = false;
        await this.refreshSyncControl();
      }
    },
    async cancelRecoveryKit() {
      await this.run('cancel_sync_recovery_kit');
      this.recoveryPhrase = '';
      this.recoveryPhraseInput = '';
      this.recoveryKit = '';
      this.recoveryPreview = null;
      this.recoveryRestored = false;
      this.restorePreview = null;
      this.restoreAccepted = false;
    },
    clearSensitive() {
      this.operation += 1;
      this.busy = false;
      this.recoveryPhrase = '';
      this.recoveryPhraseInput = '';
      this.recoveryKit = '';
      this.recoveryPreview = null;
      this.restorePreview = null;
      this.restoreAccepted = false;
      this.snapshotExport = '';
      this.pendingTombstones = [];
      this.recoveryRestored = false;
      this.invitation = '';
      this.response = '';
      this.offer = '';
      this.verificationCode = '';
      this.confirmation = '';
      this.keyTransfer = '';
      this.pairedPeer = null;
      this.peerConfirmationInput = '';
    },
    async cancelPairing() {
      await this.run('cancel_sync_pairing');
      this.invitation = '';
      this.response = '';
      this.offer = '';
      this.verificationCode = '';
      this.confirmation = '';
      this.keyTransfer = '';
      this.pairedPeer = null;
    },
  },
});
