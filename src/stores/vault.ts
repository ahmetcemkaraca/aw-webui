import { defineStore } from 'pinia';
import { clearLocalSession } from '~/util/awclient';
import { clearDecryptedState } from '~/stores/clearDecryptedState';
import { useSyncStore } from '~/stores/sync';

export interface VaultStatus {
  state: 'locked' | 'opening' | 'ready' | 'failed';
  message: string | null;
  has_vault: boolean;
  generation: number;
}

async function native(name: string, args?: object): Promise<any> {
  const bridge = (window as unknown as { __TAURI__?: { core: { invoke: (name: string, args?: object) => Promise<any> } } }).__TAURI__;
  if (!bridge) throw new Error('Open this control in PeakActivity desktop.');
  return bridge.core.invoke(name, args);
}

function clearViews() {
  clearLocalSession();
  clearDecryptedState();
  useSyncStore().clearSensitive();
}

export const useVaultStore = defineStore('vault', {
  state: () => ({ status: null as VaultStatus | null, busy: false, error: '', recoveryCode: '', operation: 0 }),
  getters: {
    isReady(state): boolean { return state.status?.state === 'ready'; },
    title(state): string {
      if (state.status?.state === 'opening') return 'Opening the encrypted vault';
      if (state.status?.state === 'ready') return 'Encrypted vault unlocked';
      return state.status?.has_vault ? 'Unlock the local vault' : 'Create an encrypted vault';
    },
  },
  actions: {
    async refresh(): Promise<VaultStatus | null> {
      try {
        const status: VaultStatus = await native('vault_status');
        this.status = status;
        if (status?.state === 'ready') this.error = '';
        return status;
      }
      catch (_) {
        this.error = 'The vault status could not be read. Check the local app and data directory.';
        return null;
      }
    },
    async unlock() { await this.run('unlock_vault'); },
    async lock() {
      this.recoveryCode = '';
      clearViews();
      await this.run('lock_vault');
      clearViews();
    },
    async backup() {
      const operation = ++this.operation;
      this.busy = true;
      this.error = '';
      this.recoveryCode = '';
      try {
        const result = await native('backup_vault');
        if (operation === this.operation && result) {
          this.recoveryCode = result.recovery_code;
          this.status = result.status;
        }
      } catch (error) {
        if (operation === this.operation) this.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (operation === this.operation) this.busy = false;
      }
    },
    async restore(recoveryCode: string, plaintext: boolean) {
      await this.run('restore_vault', { recoveryCode, plaintext });
    },
    async rotate() { await this.run('rotate_vault_key'); },
    async rollback() { await this.run('rollback_vault'); },
    async deleteLocal() { await this.run('delete_local_vault'); },
    async repairPrivacy() { await this.run('repair_privacy'); },
    async run(command: string, args?: object) {
      const operation = ++this.operation;
      this.busy = true;
      this.error = '';
      const reloadAfter = ['restore_vault', 'rotate_vault_key', 'rollback_vault', 'delete_local_vault'].includes(command);
      if (reloadAfter) {
        clearViews();
        this.recoveryCode = '';
      }
      try {
        const status: VaultStatus | null = await native(command, args);
        if (operation !== this.operation) return;
        if (!status) {
          if (reloadAfter) window.location.reload();
          return;
        }
        this.status = status;
        if (['lock_vault', 'restore_vault', 'rotate_vault_key', 'rollback_vault'].includes(command)) {
          clearViews();
          if (status.state === 'ready') window.location.reload();
        }
      } catch (error) {
        if (operation === this.operation) {
          this.error = error instanceof Error ? error.message : String(error);
          await this.refresh();
          if (reloadAfter) window.location.reload();
        }
      } finally { if (operation === this.operation) this.busy = false; }
    },
  },
});
