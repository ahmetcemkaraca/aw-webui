<template lang="pug">
div#wrapper
  nav.container.py-2(v-if="!showUpdates && (loadError || !vaultStore.isReady || !loaded || !setupComplete)" aria-label="Local app controls")
    b-button(variant="outline-secondary" aria-label="Open Updates without unlocking the vault" @click="showUpdates = true") Updates
  main.container.py-5(v-if="showUpdates" aria-labelledby="updates-title")
    h1.h4#updates-title Updates
    b-button.mb-3(variant="outline-secondary" aria-label="Back to local app" @click="closeUpdates") Back to local app
    update-settings
  main.container.py-5(v-else-if="loadError" role="alert")
    h1.h4 Cannot connect to your local vault
    p {{ loadError }}
    button.btn.btn-primary(type="button" @click="initialize") Try again
  main.container.py-5(v-else-if="!vaultStore.isReady" aria-labelledby="vault-title")
    section.card.mx-auto(style="max-width: 38rem")
      .card-body
        h1#vault-title.h4 {{ vaultStore.status && vaultStore.status.has_vault ? vaultStore.title : 'Welcome to PeakActivity' }}
        p(v-if="!vaultStore.status || vaultStore.status.state === 'opening'" role="status") Checking the local vault…
        p(v-else-if="vaultStore.status.has_vault") Unlocking opens your encrypted history. Recording stays paused until you turn it on.
        p(v-else) Create a Local Vault to set up this device. No account, AI, sync, or internet is required. Recording stays off until you choose to start it.
        p.text-danger(v-if="vaultStore.status && vaultStore.status.message" role="alert") {{ vaultStore.status.message }}
        p.text-danger(v-if="vaultStore.error" role="alert") {{ vaultStore.error }}
        p.small.text-muted(v-if="vaultStore.recoveryCode") Save this one-time recovery code separately. It is cleared when you lock the vault.
        code.d-block.user-select-all(v-if="vaultStore.recoveryCode" aria-label="Backup recovery code") {{ vaultStore.recoveryCode }}
        a.d-block.mb-2(href="#vault-import") Import existing data
        button.btn.btn-primary.mr-2(type="button" :disabled="vaultStore.busy || !vaultStore.status || vaultStore.status.state === 'opening'" @click="unlock")
          | {{ vaultStore.status && vaultStore.status.has_vault ? 'Unlock vault' : 'Create Local Vault' }}
        button.btn.btn-outline-primary.mr-2(v-if="vaultStore.status && !vaultStore.status.has_vault" type="button" :disabled="vaultStore.busy || vaultStore.status.state === 'opening'" @click="exploreWithoutRecording") Explore without recording
        button.btn.btn-outline-secondary(type="button" :disabled="vaultStore.busy" @click="initialize") Check again
        hr
        h2#vault-import.h6 Restore or migrate local data
        label.sr-only(for="vault-recovery-code") Backup recovery code
        input#vault-recovery-code.form-control.mb-2(v-model="recoveryCode" type="password" autocomplete="off" placeholder="64-character backup recovery code" :disabled="vaultStore.busy || plaintext")
        label.d-block.mb-2
          input.mr-1(v-model="plaintext" type="checkbox" :disabled="vaultStore.busy")
          | Import an unencrypted Rust database instead
        p.small.text-muted The selected source is preserved. Imported data starts with recording paused.
        button.btn.btn-outline-primary(type="button" :disabled="vaultStore.busy || (!plaintext && recoveryCode.length !== 64)" @click="restore") Select backup and restore
        button.btn.btn-outline-danger.ml-2(v-if="vaultStore.status && vaultStore.status.has_vault" type="button" :disabled="vaultStore.busy" @click="deleteLocal") Delete local vault
  p.container.py-5(v-else-if="!loaded" role="status") Opening your local vault…
  onboarding(v-else-if="!setupComplete" @complete="completeOnboarding")
  template(v-else)
    aw-header
    section.container-fluid.py-2(aria-label="Vault and recovery")
      .d-flex.flex-wrap.align-items-center
        button.btn.btn-sm.btn-outline-secondary.mr-2(type="button" :disabled="vaultStore.busy" @click="lockVault") Lock vault
        button.btn.btn-sm.btn-outline-primary.mr-2(type="button" :disabled="vaultStore.busy" @click="vaultStore.backup()") Create encrypted backup
        button.btn.btn-sm.btn-outline-secondary.mr-2(type="button" :disabled="vaultStore.busy" @click="rotate") Rotate key
        button.btn.btn-sm.btn-outline-danger(type="button" :disabled="vaultStore.busy" @click="rollback") Roll back last vault change
        button.btn.btn-sm.btn-outline-danger(type="button" :disabled="vaultStore.busy" @click="deleteLocal") Delete local vault
      p.small.text-muted.mt-2(v-if="vaultStore.recoveryCode" role="status") Save this one-time recovery code separately. It is cleared when you lock the vault.
      code.d-block.user-select-all(v-if="vaultStore.recoveryCode" aria-label="Backup recovery code") {{ vaultStore.recoveryCode }}
      p.text-danger.mt-2(v-if="vaultStore.error" role="alert") {{ vaultStore.error }}
      p.text-warning.mt-2(v-if="vaultStore.status && vaultStore.status.message" role="alert") {{ vaultStore.status.message }}
      button.btn.btn-sm.btn-outline-warning.mt-2(v-if="vaultStore.status && vaultStore.status.message" type="button" :disabled="vaultStore.busy" @click="vaultStore.repairPrivacy()") Reset privacy controls to resume recording
      details.mt-2
        summary Restore or migrate local data
        .pt-2
          label.sr-only(for="vault-recovery-code-ready") Backup recovery code
          input#vault-recovery-code-ready.form-control.mb-2(v-model="recoveryCode" type="password" autocomplete="off" placeholder="64-character backup recovery code" :disabled="vaultStore.busy || plaintext")
          label.d-block.mb-2
            input.mr-1(v-model="plaintext" type="checkbox" :disabled="vaultStore.busy")
            | Import an unencrypted Rust database instead
          p.small.text-muted The selected source is preserved. Imported data starts with recording paused.
          button.btn.btn-outline-primary(type="button" :disabled="vaultStore.busy || (!plaintext && recoveryCode.length !== 64)" @click="restore") Select backup and restore
    capture-controls(:compact="true")
    div(:class="{'container': !fullContainer, 'container-fluid': fullContainer}").px-0.px-md-2
      div.aw-container.my-sm-3.p-3
        error-boundary
          router-view
    aw-footer
</template>

<script lang="ts">
import CaptureControls from '~/components/CaptureControls.vue';
import Onboarding from '~/views/Onboarding.vue';
import UpdateSettings from '~/views/settings/UpdateSettings.vue';
import { useSettingsStore } from '~/stores/settings';
import { useServerStore } from '~/stores/server';
import { useVaultStore } from '~/stores/vault';
import { clearDecryptedState } from '~/stores/clearDecryptedState';
import { clearLocalSession } from '~/util/awclient';
import { applyTheme } from '~/util/theme';

const SETUP_KEY = 'peakactivity.setup';

function getSetupState(): string | null {
  try { return localStorage.getItem(SETUP_KEY); } catch (_) { return null; }
}

function setSetupState(state: string): void {
  try { localStorage.setItem(SETUP_KEY, state); } catch (_) { /* Setup can still finish for this session. */ }
}

export default {
  components: { CaptureControls, Onboarding, UpdateSettings },
  data() {
    return {
      loaded: false,
      showUpdates: this.$route.path === '/settings/updates',
      initialization: 0,
      setupComplete: false,
      newVault: false,
      loadError: '',
      recoveryCode: '',
      plaintext: false,
      pollTimer: null as number | null,
      vaultCheckTimer: null as number | null,
      checkingVault: false,
      observedGeneration: null as number | null,
    };
  },
  computed: {
    fullContainer() { return this.$route.meta.fullContainer; },
    vaultStore() { return useVaultStore(); },
  },
  created() { this.initialize(); },
  mounted() { this.vaultCheckTimer = window.setInterval(() => this.checkVaultState(), 15000); },
  beforeDestroy() {
    this.initialization++;
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    if (this.vaultCheckTimer !== null) window.clearInterval(this.vaultCheckTimer);
    this.recoveryCode = '';
  },
  methods: {
    closeUpdates() {
      this.loaded = false;
      this.showUpdates = false;
      this.initialize();
    },
    async initialize() {
      if (this.showUpdates) return;
      const current = ++this.initialization;
      this.loadError = '';
      const status = await this.vaultStore.refresh();
      if (this.showUpdates || current !== this.initialization) return;
      this.vaultStore.status = status;
      if (!status) {
        this.loadError = 'The local vault status could not be confirmed. Try again or open Updates.';
      }
      if (status?.state === 'opening') {
        this.recoveryCode = this.vaultStore.recoveryCode = '';
        if (this.pollTimer === null) this.pollTimer = window.setTimeout(() => { this.pollTimer = null; this.initialize(); }, 500);
        return;
      }
      if (status?.state !== 'ready') {
        this.loaded = false;
        this.recoveryCode = this.vaultStore.recoveryCode = '';
        this.observedGeneration = status?.generation ?? null;
        clearLocalSession();
        clearDecryptedState();
        return;
      }
      const setupState = getSetupState();
      if (setupState === 'complete') this.setupComplete = true;
      else if (setupState === 'pending') this.setupComplete = false;
      else if (this.newVault) this.setupComplete = false;
      else if (status.has_vault) {
        this.setupComplete = true;
        setSetupState('complete');
      }
      this.observedGeneration = status.generation;
      if (this.loaded) return;
      this.loaded = false;
      clearLocalSession();
      try {
        const settings = useSettingsStore();
        await settings.ensureLoaded();
        if (this.showUpdates || current !== this.initialization) return;
        await useServerStore().getInfo();
        if (this.showUpdates || current !== this.initialization) return;
        applyTheme(settings.theme);
        this.loaded = true;
      } catch (_) {
        if (this.showUpdates || current !== this.initialization) return;
        this.loadError = 'Open this view from PeakActivity desktop and make sure your vault is unlocked. Your local data has not been reset.';
      }
    },
    async checkVaultState() {
      if (this.showUpdates || this.checkingVault) return;
      this.checkingVault = true;
      try {
        const previousGeneration = this.observedGeneration;
        await this.vaultStore.refresh();
        if (this.showUpdates) return;
        const status = this.vaultStore.status;
        if (!status || status.state === 'opening') return;
        if (status.state !== 'ready') {
          this.loaded = false;
          this.recoveryCode = '';
          this.observedGeneration = status.generation;
          clearLocalSession();
          clearDecryptedState();
          return;
        }
        if (this.loaded && previousGeneration !== null && status.generation !== previousGeneration) {
          window.location.reload();
          return;
        }
        this.observedGeneration = status.generation;
      } finally {
        this.checkingVault = false;
      }
    },
    async unlock() {
      this.loaded = false;
      this.newVault = !this.vaultStore.status?.has_vault;
      if (this.newVault) setSetupState('pending');
      else if (!getSetupState()) setSetupState('complete');
      await this.vaultStore.unlock();
      if (this.vaultStore.isReady) await this.initialize();
    },
    async exploreWithoutRecording() {
      await this.unlock();
      if (this.vaultStore.isReady) this.completeOnboarding();
    },
    completeOnboarding() {
      setSetupState('complete');
      this.setupComplete = true;
      this.newVault = false;
    },
    async lockVault() {
      this.recoveryCode = '';
      await this.vaultStore.lock();
    },
    async deleteLocal() {
      this.recoveryCode = '';
      await this.vaultStore.deleteLocal();
    },
    async restore() {
      await this.vaultStore.restore(this.recoveryCode, this.plaintext);
      this.recoveryCode = '';
    },
    async rollback() {
      if (window.confirm('Roll back to the previous local vault?')) await this.vaultStore.rollback();
    },
    async rotate() {
      if (window.confirm('Rotate the vault key? A rollback copy will be kept on this device.')) await this.vaultStore.rotate();
    },
  },
};
</script>
