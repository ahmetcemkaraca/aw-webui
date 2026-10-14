<template lang="pug">
section(aria-labelledby="update-integrity-title" :aria-busy="store.loading")
  h2.h5#update-integrity-title Local release verification
  p Verify the signatures and local files in a release bundle. This works offline without an account or an unlocked vault.
  p.small.text-muted Verification does not download or install anything, or confirm that a release is suitable for installation.
  div.d-flex.flex-wrap.mb-3
    b-button.mr-2.mb-2(variant="outline-secondary" :disabled="!store.nativeAvailable || store.loading" @click="store.refreshStatus()") Refresh status
    b-button.mb-2(variant="primary" :disabled="!canVerify || store.loading" @click="store.verifyBundle()") Verify local release bundle
  p(role="status" aria-live="polite") {{ statusMessage }}
  p.text-danger(v-if="store.error" role="alert") {{ store.error }}
  p(v-if="store.status") Installed version: {{ store.status.installed_version }}
  section(v-if="store.result" aria-labelledby="verified-bundle-title")
    h3.h6#verified-bundle-title Verified local bundle
    p Signed version: {{ store.result.version }}
    p Channel: {{ store.result.channel }} · Support: {{ store.result.support_status }}
    p Platform: {{ store.result.platform }} · Native architecture: {{ store.result.native_architecture }}
    p Artifact architecture: {{ store.result.artifact_architecture }}
    p.text-break Source revision: {{ store.result.source_revision }}
    p.text-break Manifest signer fingerprint: {{ store.result.manifest_fingerprint }}
    p.text-break Artifact signer fingerprint: {{ store.result.artifact_fingerprint }}
    p All referenced local file hashes and OpenPGP signatures verified. Older signed bundles can be inspected for manual recovery.
  ul.small.mb-0(aria-label="Verification limits")
    li Public source and evidence readback: Not checked
    li Platform signature: Not checked
    li Release freshness: Not checked
    li Key lifecycle: Not checked
</template>

<script lang="ts">
import { useUpdatesStore } from '~/stores/updates';

export default {
  name: 'UpdateSettings',
  props: { active: { type: Boolean, default: true } },
  data() { return { store: useUpdatesStore() }; },
  computed: {
    canVerify(): boolean { return this.store.nativeAvailable && this.store.status?.state === 'ready'; },
    statusMessage(): string {
      if (!this.store.nativeAvailable) return 'Open Updates in PeakActivity desktop.';
      if (this.store.loading) return this.store.status ? 'Checking local release integrity…' : 'Loading release verification status…';
      if (this.store.error) return 'Release verification is unavailable. Review the error and try again.';
      if (this.store.cancelled) return 'Selection cancelled. No bundle was verified.';
      if (this.store.result) return 'Local bundle integrity verified. Installation and release approval remain unchecked.';
      if (this.store.status?.state === 'not-configured') return 'Not configured. No approved release signing trust or verifier is configured.';
      if (this.store.status?.state === 'unavailable') return 'Unavailable. Release verification resources need attention.';
      return this.canVerify ? 'Ready to verify a local release bundle.' : 'Refresh status to check local verification resources.';
    },
  },
  watch: {
    active: {
      immediate: true,
      handler(active: boolean) {
        if (active) this.store.refreshStatus();
        else this.store.clearSensitive();
      },
    },
  },
  beforeDestroy() { this.store.$dispose(); },
};
</script>
