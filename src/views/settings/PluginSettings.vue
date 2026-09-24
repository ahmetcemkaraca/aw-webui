<template lang="pug">
section(aria-labelledby="plugin-settings-title")
  h5#plugin-settings-title Permissioned plugins
  p(role="status" aria-live="polite" v-if="loading") Checking plugin availability…
  p.text-danger(role="alert" v-else-if="error") {{ error }}
  template(v-else-if="status")
    p(role="status") Plugin runtime build: {{ status.runtime_compiled ? 'present, not enabled' : 'not included' }}. Operational runtime: {{ status.runtime_available ? 'available' : 'unavailable' }}. Marketplace: {{ status.marketplace_available ? 'available' : 'unavailable' }}. Signed Egress purpose: {{ status.signed_purpose_available ? 'available' : 'unavailable' }}.
    p.small.text-muted(v-if="!status.runtime_available") No plugin module can be installed or executed in this build. The sandbox runtime, publisher trust registry and independent package review are not provisioned.
    p.small.text-muted Network grants cannot create outbound routes. A future plugin must use an existing signed Privacy Firewall purpose and exact destination.
    ul.small(v-if="status.blocker_ids.length" aria-label="Plugin release gates")
      li(v-for="blocker in status.blocker_ids" :key="blocker") {{ blockerLabel(blocker) }}
    p.small.text-muted No publisher keys, package source, marketplace, billing provider or plugin code is loaded by this status check.
</section>
</template>

<script lang="ts">
import { getClient } from '~/util/awclient';

interface PluginStatus {
  schema_version: 1;
  runtime_compiled: boolean;
  runtime_available: boolean;
  marketplace_available: boolean;
  signed_purpose_available: boolean;
  blocker_ids: string[];
}

const blockerLabels: Record<string, string> = {
  capability_host_broker: 'Plugin approval and install/update/revoke/delete lifecycle integration',
  sandbox_escape_review: 'Independent sandbox escape review and native validation',
  publisher_trust_registry: 'Release-owned publisher trust registry',
  package_review_and_provenance: 'Security, license and reproducible-build review',
  marketplace_operations: 'Marketplace, billing and support operations',
};

export default {
  name: 'PluginSettings',
  data() {
    return { status: null as PluginStatus | null, loading: true, error: '' };
  },
  async created() {
    try {
      const response = await getClient().req.get('/api/0/plugins/status');
      this.status = response.data as PluginStatus;
    } catch (_) {
      this.error = 'Plugin availability could not be checked. No plugin is installed or enabled.';
    } finally {
      this.loading = false;
    }
  },
  methods: {
    blockerLabel(blocker: string): string { return blockerLabels[blocker] || 'Additional release review'; },
  },
};
</script>
