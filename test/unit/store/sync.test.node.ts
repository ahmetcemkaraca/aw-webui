import { createPinia, setActivePinia } from 'pinia';
import { useSyncStore } from '~/stores/sync';
import experience from '~/generated/product-experience.json';
import { isShipped } from '~/product/experience';
import { readFileSync } from 'fs';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('~/util/awclient', () => ({
  getClient: () => ({ req: { get: mockGet, post: mockPost } }),
}));

describe('encrypted device pairing state', () => {
  let invoke: jest.Mock;

  beforeEach(() => {
    setActivePinia(createPinia());
    mockGet.mockReset();
    mockPost.mockReset();
    invoke = jest.fn();
    (global as any).window = { __TAURI__: { core: { invoke } } };
  });

  afterEach(() => {
    delete (global as any).window;
  });

  test('keeps only public identity and pairing messages in UI state', async () => {
    const store = useSyncStore();
    const device = {
      schema_version: 1,
      device_id: 'AQEBAQEBAQEBAQEBAQEBAQ',
      x25519_public_key: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
    };
    const invitation = {
      schema_version: 1,
      offer_id: 'AwMDAwMDAwMDAwMDAwMDAw',
      issuer: device,
      recipient_device_id: 'BAQEBAQEBAQEBAQEBAQEBA',
      issuer_ephemeral_key: device.x25519_public_key,
      challenge: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
    };
    invoke.mockResolvedValueOnce([{ ...device, is_current_device: true }]);
    invoke.mockResolvedValueOnce(invitation);

    await store.refresh();
    await store.createPairing(JSON.stringify(device));

    expect(store.devices).toHaveLength(1);
    expect(store.invitation).toContain(invitation.offer_id);
    expect(JSON.stringify(store.$state)).not.toContain('private_key');
    expect(invoke).toHaveBeenNthCalledWith(2, 'create_sync_pairing', { recipient: device });
  });

  test('creates and exposes only the current device public identity', async () => {
    const store = useSyncStore();
    const identity = {
      schema_version: 1,
      device_id: 'AQEBAQEBAQEBAQEBAQEBAQ',
      x25519_public_key: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
    };
    invoke.mockResolvedValue(identity);

    await store.createLocalIdentity();

    expect(store.devices).toEqual([{ ...identity, is_current_device: true }]);
    expect(JSON.stringify(store.$state)).not.toContain('private_key');
    expect(invoke).toHaveBeenCalledWith('create_local_sync_identity');
  });

  test('does not call native pairing with malformed JSON', async () => {
    const store = useSyncStore();
    await store.createPairing('{');
    expect(invoke).not.toHaveBeenCalled();
    expect(store.error).not.toBe('');
  });

  test('stores only the encrypted handoff and public paired-device identity', async () => {
    const store = useSyncStore();
    const encryptedTransfer = {
      schema_version: 1,
      offer_id: 'AwMDAwMDAwMDAwMDAwMDAw',
      nonce: 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
      ciphertext: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
    };
    invoke
      .mockResolvedValueOnce(encryptedTransfer)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await store.createKeyTransfer(JSON.stringify({ authenticator: 'public confirmation' }));
    expect(store.keyTransfer).toContain(encryptedTransfer.ciphertext);
    expect(JSON.stringify(store.$state)).not.toContain('account_root_key');

    const peer = {
      schema_version: 1,
      device_id: 'BgYGBgYGBgYGBgYGBgYGBg',
      x25519_public_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
    };
    invoke.mockReset();
    invoke
      .mockResolvedValueOnce(peer)
      .mockResolvedValueOnce([{ ...peer, is_current_device: false }])
      .mockResolvedValueOnce([]);
    await store.acceptKeyTransfer(
      JSON.stringify({ authenticator: 'public confirmation' }),
      JSON.stringify(encryptedTransfer)
    );
    expect(store.pairedPeer?.device_id).toBe(peer.device_id);
    expect(JSON.stringify(store.$state)).not.toContain('private_key');
  });

  test('shows a recovery phrase once and clears it after explicit save confirmation', async () => {
    const store = useSyncStore();
    const recovery = {
      recovery_phrase: 'SYNTHETIC_RECOVERY_PHRASE',
      kit: { schema_version: 1, kdf: 'argon2id-v19', ciphertext: 'opaque-ciphertext' },
    };
    invoke.mockResolvedValueOnce(recovery).mockResolvedValueOnce(undefined);

    await store.createRecoveryKit();
    expect(store.recoveryPhrase).toBe(recovery.recovery_phrase);
    expect(store.recoveryKit).toContain('opaque-ciphertext');
    await store.confirmRecoverySaved(true);

    expect(store.recoveryPhrase).toBe('');
    expect(store.recoveryConfirmed).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('confirm_sync_recovery_saved', { userConfirmed: true });
  });

  test('clears recovery phrases from memory when decrypted views are cleared', () => {
    const store = useSyncStore();
    store.recoveryPhrase = 'SYNTHETIC_SAVED_PHRASE';
    store.recoveryPhraseInput = 'SYNTHETIC_ENTERED_PHRASE';

    store.clearSensitive();

    expect(store.recoveryPhrase).toBe('');
    expect(store.recoveryPhraseInput).toBe('');
  });

  test('cancels an unconfirmed one-time recovery phrase and clears it', async () => {
    const store = useSyncStore();
    store.recoveryPhrase = 'SYNTHETIC_UNCONFIRMED_PHRASE';
    store.recoveryKit = '{"ciphertext":"opaque"}';
    invoke.mockResolvedValue(undefined);

    await store.cancelRecoveryKit();

    expect(store.recoveryPhrase).toBe('');
    expect(store.recoveryKit).toBe('');
    expect(invoke).toHaveBeenCalledWith('cancel_sync_recovery_kit');
  });

  test('key rotation invalidates the saved recovery state and refreshes stale devices', async () => {
    const store = useSyncStore();
    store.recoveryConfirmed = true;
    invoke
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce([{ device_id: 'old-device', needs_repair: true }]);

    await store.rotateKeys();

    expect(store.recoveryConfirmed).toBe(false);
    expect(store.devices[0].needs_repair).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, 'rotate_sync_keys');
    expect(invoke).toHaveBeenNthCalledWith(2, 'list_sync_devices');
  });

  test('exports only the opaque encrypted snapshot from the native vault', async () => {
    const store = useSyncStore();
    const snapshot = {
      schema_version: 1,
      snapshot_id: 'opaque-snapshot',
      envelopes: [{ ciphertext: 'encrypted-activity' }],
    };
    invoke
      .mockResolvedValueOnce({
        schema_version: 1,
        key_epoch: 1,
        snapshot_id: 'opaque-snapshot',
        object_count: 1,
      })
      .mockResolvedValueOnce(snapshot);

    await store.exportSnapshot();

    expect(store.snapshotExport).toContain('encrypted-activity');
    expect(store.backupVersions).toEqual([
      {
        schema_version: 1,
        snapshot_id: 'opaque-snapshot',
        key_epoch: 0,
        object_count: 1,
      },
    ]);
    expect(invoke).toHaveBeenNthCalledWith(1, 'create_current_sync_snapshot');
    expect(invoke).toHaveBeenNthCalledWith(2, 'export_sync_snapshot');
  });

  test('cancel clears public exchange data and cancels native ephemeral state', async () => {
    const store = useSyncStore();
    store.invitation = '{"offer_id":"test"}';
    store.offer = '{"offer_id":"test"}';
    store.verificationCode = '12345678';
    invoke.mockResolvedValue(undefined);

    await store.cancelPairing();

    expect(store.invitation).toBe('');
    expect(store.offer).toBe('');
    expect(store.verificationCode).toBe('');
    expect(invoke).toHaveBeenCalledWith('cancel_sync_pairing');
  });

  test('enables relay sync only for a signed sync purpose and stops with explicit consent off', async () => {
    const store = useSyncStore();
    mockGet
      .mockResolvedValueOnce({
        data: { outbound_enabled: true, kill_switch_enabled: false },
      })
      .mockResolvedValueOnce({
        data: {
          destinations: [{ id: 'signed-relay', status: 'available' }],
          purposes: [{ id: 'sync-object-v1', destination_id: 'signed-relay' }],
        },
      });
    const baseline = { baseline_max_event_id: 7, baseline_cursor: 7, complete: true };
    mockPost.mockResolvedValueOnce({ data: { enabled: true, preparing: false, baseline } });

    await store.setSyncEnabled(true);

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/0/sync/enabled', {
      enabled: true,
      destination_id: 'signed-relay',
      purpose_id: 'sync-object-v1',
    });
    expect(store.syncEnabled).toBe(true);

    mockPost.mockResolvedValueOnce({ data: { enabled: false } });
    await store.setSyncEnabled(false);
    expect(mockPost).toHaveBeenLastCalledWith('/api/0/sync/enabled', { enabled: false });
    expect(store.syncEnabled).toBe(false);
    expect(store.baselineProgress).not.toBeNull();
  });

  test('keeps consent off while the bounded baseline is preparing', async () => {
    const store = useSyncStore();
    mockGet
      .mockResolvedValueOnce({ data: { outbound_enabled: true, kill_switch_enabled: false } })
      .mockResolvedValueOnce({ data: {
        destinations: [{ id: 'signed-relay', status: 'available' }],
        purposes: [{ id: 'sync-object-v1', destination_id: 'signed-relay' }],
      } });
    invoke.mockResolvedValueOnce({});
    const baseline = { baseline_max_event_id: 300, baseline_cursor: 128, complete: false };
    mockPost.mockResolvedValueOnce({ data: { enabled: false, preparing: true, baseline } });

    await store.setSyncEnabled(true);

    expect(store.syncEnabled).toBe(false);
    expect(store.syncPreparing).toBe(true);
    expect(store.baselineProgress).toEqual(baseline);
  });

  test('keeps network sync blocked while the signed capability is Planned', () => {
    expect(isShipped('e2ee-sync', experience)).toBe(false);
  });

  test('explains that stopping sync retains the encrypted operation queue', () => {
    const settings = readFileSync('src/views/settings/SyncSettings.vue', 'utf8');
    expect(settings).toContain('pauses relay transfer and retains the encrypted operation queue');
  });

  test('keeps sync disabled when the signed policy has no sync destination', async () => {
    const store = useSyncStore();
    mockGet
      .mockResolvedValueOnce({
        data: { outbound_enabled: true, kill_switch_enabled: false },
      })
      .mockResolvedValueOnce({
        data: {
          destinations: [{ id: 'other-relay', status: 'available' }],
          purposes: [{ id: 'ai-analysis', destination_id: 'other-relay' }],
        },
      });

    await store.setSyncEnabled(true);

    expect(mockPost).not.toHaveBeenCalled();
    expect(store.syncEnabled).toBe(false);
    expect(store.error).toBe('No trusted signed sync destination is configured.');
  });

  test('refreshes pending tombstone device IDs without exposing event values', async () => {
    const store = useSyncStore();
    const tombstoneStatus = {
      origin_device_id: 'opaque-origin-device',
      local_event_id: 27,
      tombstone_counter: 9,
      active_device_ids: ['opaque-peer-a', 'opaque-peer-b'],
      pending_device_ids: ['opaque-peer-b'],
    };
    invoke.mockResolvedValueOnce([tombstoneStatus]);

    await store.refreshTombstoneStatuses();

    expect(store.pendingTombstones).toEqual([tombstoneStatus]);
    expect(JSON.stringify(store.pendingTombstones)).not.toContain('private-activity-marker');
  });

  test('previews recovery without writing until the user accepts it', async () => {
    const store = useSyncStore();
    const kit = { schema_version: 1, ciphertext: 'encrypted-kit' };
    const snapshot = { schema_version: 1, snapshot_id: 'opaque-snapshot', envelopes: [] };
    const preview = {
      schema_version: 1,
      vault_id: 'opaque-vault',
      key_epoch: 4,
      snapshot_id: 'opaque-snapshot',
      object_count: 1,
      version_start: '2026-01-01T00:00:00Z',
      version_end: '2026-01-02T00:00:00Z',
      tombstone_count: 0,
      query_start: '2026-01-01T00:00:00Z',
      query_end: '2026-01-02T00:00:00Z',
      policy_conflict_count: 0,
    };
    invoke.mockResolvedValueOnce(preview).mockResolvedValueOnce(preview);

    await store.previewRecoveryRestore(JSON.stringify(kit), 'phrase', JSON.stringify(snapshot));

    expect(invoke).toHaveBeenNthCalledWith(1, 'preview_sync_recovery_restore', {
      kit,
      recoveryPhrase: 'phrase',
      snapshot,
    });
    expect(store.restorePreview).toEqual(preview);
    expect(store.recoveryRestored).toBe(false);

    await store.acceptRecoveryRestore(
      JSON.stringify(kit),
      'phrase',
      JSON.stringify(snapshot),
      false
    );
    expect(invoke).toHaveBeenCalledTimes(1);

    await store.acceptRecoveryRestore(
      JSON.stringify(kit),
      'phrase',
      JSON.stringify(snapshot),
      true
    );
    expect(invoke).toHaveBeenNthCalledWith(2, 'restore_sync_recovery_kit', {
      kit,
      recoveryPhrase: 'phrase',
      snapshot,
      userAccepted: true,
    });
    expect(store.recoveryRestored).toBe(true);
  });
});
