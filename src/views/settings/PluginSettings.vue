<template lang="pug">
section.plugin-settings(aria-labelledby="plugin-settings-title")
  h5#plugin-settings-title Permissioned plugins
  p(role="status" aria-live="polite" v-if="loading") Checking plugin availability…
  p.text-danger(role="alert" v-if="error") {{ error }}
  p(role="status" aria-live="polite" v-if="notice") {{ notice }}
  template(v-if="status")
    p(role="status") Plugin runtime build: {{ status.runtime_compiled ? 'present' : 'not included' }}. Operational runtime: {{ status.runtime_available ? 'available' : 'unavailable' }}. Marketplace: {{ status.marketplace_available ? 'available' : 'unavailable' }}. Signed Egress purpose: {{ status.signed_purpose_available ? 'available' : 'unavailable' }}.
    p.small.text-muted(v-if="!status.runtime_available") No plugin module can be installed or executed in this build. Publisher trust and independent sandbox and package review must pass before activation.
    p.small.text-muted Network grants cannot create outbound routes. Plugins must use an existing signed Privacy Firewall purpose and exact destination.
    ul.small(v-if="status.blocker_ids.length" aria-label="Plugin release gates")
      li(v-for="blocker in status.blocker_ids" :key="blocker") {{ blockerLabel(blocker) }}
    button.btn.btn-outline-secondary(type="button" @click="refresh" :disabled="busy || loading") Refresh plugin status
    section.mt-4(aria-labelledby="plugin-package-title")
      h6#plugin-package-title Review a local package
      p.small Package details are untrusted until the server verifies the signature, module and publisher. Installing or updating leaves execution disabled until you grant the displayed permissions.
      label(for="plugin-package") Signed package JSON
      input#plugin-package.form-control-file(type="file" accept=".json,application/json" :disabled="!canRun || busy" @change="readPackage")
      label.mt-2(for="plugin-module") WebAssembly module
      input#plugin-module.form-control-file(type="file" accept=".wasm,application/wasm" :disabled="!canRun || busy" @change="readModule")
      template(v-if="candidate")
        p.mt-3 {{ candidate.manifest.display_name }} · {{ candidate.manifest.version }} · Publisher key: {{ candidate.manifest.publisher_key_id }}
        p {{ candidate.manifest.description }}
        details(open)
          summary Requested permissions
          pre {{ format(candidate.manifest.capabilities) }}
        details(v-if="candidateInstalled")
          summary Currently installed permissions — compare before updating
          pre {{ format(candidateInstalled.manifest.capabilities) }}
        label.d-block
          input.mr-2(type="checkbox" v-model="packageConfirmed" :disabled="busy")
          | I have reviewed this package and its requested permissions. An update disables the current version.
        button.btn.btn-outline-primary(type="button" @click="install" :disabled="!canRun || busy || !moduleBytes || !packageConfirmed") {{ candidateInstalled ? 'Update and review permission changes' : 'Install disabled plugin' }}
    section.mt-4(aria-labelledby="plugins-installed-title")
      h6#plugins-installed-title Installed plugins
      p.small(v-if="!status.lifecycle_available") Local plugin management is unavailable. Unlock an encrypted vault in a build with plugin lifecycle support, then refresh.
      p(v-else-if="!plugins.length && !loading") No plugins installed.
      article.border-top.py-3(v-for="plugin in plugins" :key="plugin.manifest.plugin_id")
        h6 {{ plugin.manifest.display_name }} · {{ plugin.manifest.version }}
        p.small Publisher key: {{ plugin.manifest.publisher_key_id }} · {{ plugin.revoked ? 'Revoked' : plugin.enabled ? 'Enabled' : 'Disabled' }}{{ plugin.consent_required ? ' — permission consent required' : '' }}
        p.small Package: {{ plugin.package_sha256 }}
        p.small(v-if="plugin.manifest.capabilities.background") Last background attempt: {{ plugin.last_background_run_at || 'Not run yet' }}
        details
          summary Requested manifest permissions
          p.small(v-if="plugin.manifest.capabilities.background") Granting this schedule allows local background execution at the declared interval. Annotations, exports, deletions and network sends still require separate approval.
          pre {{ format(plugin.manifest.capabilities) }}
        details(v-if="diffs[plugin.manifest.plugin_id]" open)
          summary Update permission changes
          p Added: {{ diffs[plugin.manifest.plugin_id].added.join(', ') || 'None' }}
          p Removed: {{ diffs[plugin.manifest.plugin_id].removed.join(', ') || 'None' }}
          p The updated package stays disabled until you explicitly grant its permissions.
        div.d-flex.flex-wrap
          button.btn.btn-outline-primary.mr-2.mb-2(type="button" @click="confirmAction(plugin, 'consent')" :disabled="!canRun || busy || plugin.revoked || plugin.enabled") Review and grant permissions
          button.btn.btn-outline-primary.mr-2.mb-2(type="button" @click="invoke(plugin)" :disabled="!canRun || busy || !plugin.enabled || plugin.revoked || plugin.consent_required") Run and preview actions
          button.btn.btn-outline-secondary.mr-2.mb-2(type="button" @click="loadPending(plugin)" :disabled="busy") Review pending actions
          button.btn.btn-outline-secondary.mr-2.mb-2(type="button" @click="loadHistory(plugin)" :disabled="busy") Access history
          button.btn.btn-outline-danger.mr-2.mb-2(type="button" @click="confirmAction(plugin, 'revoke')" :disabled="busy || plugin.revoked") Revoke package
          button.btn.btn-outline-danger.mb-2(type="button" @click="confirmAction(plugin, 'delete')" :disabled="busy") Delete plugin and its data
    section.mt-3(v-if="confirmation" ref="confirmation" tabindex="-1" aria-labelledby="plugin-confirm-title")
      h6#plugin-confirm-title {{ confirmation.action === 'consent' ? 'Grant permissions' : confirmation.action === 'revoke' ? 'Revoke this package' : 'Delete plugin data' }}: {{ confirmation.plugin.manifest.display_name }}
      p.small(v-if="confirmation.action === 'consent' && confirmation.plugin.manifest.capabilities.background") This grant also enables the displayed background schedule. Pending writes and external actions still need separate approval.
      pre(v-if="confirmation.action === 'consent'") {{ format(confirmation.plugin.manifest.capabilities) }}
      p(v-else-if="confirmation.action === 'revoke'") This package will stop running. Revocation cannot be undone for this exact package; a different reviewed package is required.
      p(v-else) This permanently deletes this plugin’s installed module, annotations and private storage. Your activity vault is not deleted. Package revocations remain in effect.
      label.d-block
        input.mr-2(type="checkbox" v-model="actionConfirmed" :disabled="busy")
        | I confirm this action for the displayed package.
      button.btn.btn-danger.mr-2(type="button" @click="applyAction" :disabled="busy || !actionConfirmed") Confirm {{ confirmation.action === 'consent' ? 'permission grant' : confirmation.action }}
      button.btn.btn-outline-secondary(type="button" @click="confirmation = null" :disabled="busy") Cancel
    section.mt-3(v-if="history !== null" aria-labelledby="plugin-history-title")
      h6#plugin-history-title Plugin access history
      p.small Content-free local records for {{ historyName }}.
      pre {{ format(history) }}
    section.mt-3(v-if="pendingPlugin" aria-labelledby="plugin-pending-title")
      h6#plugin-pending-title Pending actions: {{ pendingPlugin.manifest.display_name }}
      p.small Background execution never approves these actions. Expired previews must be generated again.
      p(v-if="!pending.length") No pending action previews.
      ul(v-else)
        li.mb-2(v-for="item in pending" :key="item.invocation_id")
          button.btn.btn-outline-primary(type="button" @click="openPreview(pendingPlugin, item)" :disabled="busy || !canRun") Review {{ item.background ? 'background' : 'manual' }} run — expires {{ item.expires_at }}
    PluginActions(v-if="invocation && invokedPlugin" :key="invocation.invocation_id" :invocation="invocation" :plugin="invokedPlugin" :available="canRun" @busy="actionsBusy = $event" @close="clearInvocation" @saved="notice = 'Approved annotations saved in encrypted plugin storage.'")
</section>
</template>

<script lang="ts">
import Vue from 'vue';
import { getClient } from '~/util/awclient';
import PluginActions from '~/components/PluginActions.vue';

const base = '/api/0/plugins';
const blockerLabels: Record<string, string> = {
  capability_host_broker: 'Plugin approval and install/update/revoke/delete lifecycle integration',
  sandbox_escape_review: 'Independent sandbox escape review and native validation',
  publisher_trust_registry: 'Release-owned publisher trust registry',
  package_review_and_provenance: 'Security, license and reproducible-build review',
  marketplace_operations: 'Marketplace, billing and support operations',
};

export default Vue.extend({
  name: 'PluginSettings',
  components: { PluginActions },
  data() {
    return {
      status: null as any, plugins: [] as any[], loading: true, working: false, actionsBusy: false, error: '', notice: '',
      candidate: null as any, moduleBytes: null as number[] | null, packageConfirmed: false,
      confirmation: null as any, actionConfirmed: false, diffs: {} as Record<string, any>,
      history: null as any, historyName: '', invocation: null as any, invokedPlugin: null as any,
      pending: [] as any[], pendingPlugin: null as any,
    };
  },
  computed: {
    busy(): boolean { return this.working || this.actionsBusy; },
    canRun(): boolean { return this.status?.runtime_available === true && this.status?.lifecycle_available === true; },
    candidateInstalled(): any { return this.plugins.find(plugin => plugin.manifest.plugin_id === this.candidate?.manifest.plugin_id); },
  },
  created() { this.refresh(); },
  methods: {
    format(value: unknown): string { return JSON.stringify(value, null, 2); },
    blockerLabel(blocker: string): string { return blockerLabels[blocker] || 'Additional release review'; },
    path(plugin: any): string { return `${base}/${encodeURIComponent(plugin.manifest.plugin_id)}`; },
    clearInvocation() { this.invocation = null; this.invokedPlugin = null; },
    async refresh() {
      this.loading = true;
      this.error = '';
      this.status = null;
      this.plugins = [];
      this.confirmation = null;
      this.pending = [];
      this.pendingPlugin = null;
      this.clearInvocation();
      try {
        this.status = (await getClient().req.get(`${base}/status`)).data;
        if (this.status.lifecycle_available) this.plugins = (await getClient().req.get(`${base}/installed`)).data.plugins;
      } catch (_) {
        this.status = null;
        this.error = 'Plugin status could not be loaded. Refresh after checking the local server and vault.';
      } finally { this.loading = false; }
    },
    async readPackage(event: Event) {
      this.candidate = null;
      this.packageConfirmed = false;
      this.error = '';
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || !this.canRun || this.busy) return;
      try {
        if (file.size > 1024 * 1024) throw new Error('size');
        const candidate = JSON.parse(await file.text());
        if (candidate?.schema_version !== 1 || !candidate.manifest?.plugin_id || !candidate.manifest?.capabilities) throw new Error('format');
        this.candidate = candidate;
      } catch (_) { this.error = 'Choose a signed package JSON file no larger than 1 MiB. The server validates its full contract before installation.'; }
    },
    async readModule(event: Event) {
      this.moduleBytes = null;
      this.packageConfirmed = false;
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || !this.canRun || this.busy) return;
      try {
        if (!file.size || file.size > 16 * 1024 * 1024) throw new Error('size');
        this.moduleBytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      } catch (_) { this.error = 'Choose a WebAssembly module between 1 byte and 16 MiB.'; }
    },
    async install() {
      if (!this.canRun || this.busy || !this.candidate || !this.moduleBytes || !this.packageConfirmed) return;
      this.working = true;
      this.error = '';
      const installed = this.candidateInstalled;
      try {
        const body = { package: this.candidate, module_bytes: this.moduleBytes };
        const response = installed
          ? await getClient().req.post(`${this.path(installed)}/update`, { ...body, expected_package_sha256: installed.package_sha256 })
          : await getClient().req.post(`${base}/install`, body);
        if (installed) this.$set(this.diffs, installed.manifest.plugin_id, response.data.capability_diff);
        this.candidate = null;
        this.moduleBytes = null;
        this.packageConfirmed = false;
        await this.refresh();
        this.notice = 'Package saved disabled. Review the permissions before granting access.';
      } catch (_) { this.error = 'Package was not accepted. Check the release gates, signature and permissions, then refresh before retrying.'; }
      finally { this.working = false; }
    },
    confirmAction(plugin: any, action: string) {
      if (this.busy || (action === 'consent' && (!this.canRun || plugin.revoked))) return;
      this.clearInvocation();
      this.actionConfirmed = false;
      this.confirmation = { plugin, action };
      this.$nextTick(() => (this.$refs.confirmation as HTMLElement)?.focus());
    },
    async applyAction() {
      if (!this.confirmation || !this.actionConfirmed || this.busy) return;
      const { plugin, action } = this.confirmation;
      if (action === 'consent' && (!this.canRun || plugin.revoked)) return;
      this.working = true;
      this.error = '';
      try {
        const body = { package_sha256: plugin.package_sha256, confirmed: true };
        if (action === 'delete') await getClient().req.delete(this.path(plugin), { data: body });
        else await getClient().req.post(`${this.path(plugin)}/${action}`, body);
        this.history = null;
        await this.refresh();
        this.notice = action === 'delete' ? 'Plugin and its data deleted.' : action === 'revoke' ? 'Package revoked.' : 'Permissions granted for this package.';
      } catch (_) {
        this.confirmation = null;
        this.error = 'Plugin action could not be confirmed. Refresh to check its current state before retrying.';
      } finally { this.actionConfirmed = false; this.working = false; }
    },
    async loadHistory(plugin: any) {
      if (this.busy) return;
      this.working = true;
      this.error = '';
      this.history = null;
      try {
        this.history = (await getClient().req.get(`${this.path(plugin)}/history`)).data;
        this.historyName = plugin.manifest.display_name;
      } catch (_) { this.error = 'Plugin access history could not be loaded. Refresh and try again.'; }
      finally { this.working = false; }
    },
    async loadPending(plugin: any) {
      if (this.busy) return;
      this.working = true;
      this.error = '';
      this.clearInvocation();
      this.pending = [];
      this.pendingPlugin = null;
      try {
        this.pending = (await getClient().req.get(`${this.path(plugin)}/pending`)).data.invocations;
        this.pendingPlugin = plugin;
      } catch (_) { this.error = 'Pending plugin actions could not be loaded. Refresh and try again.'; }
      finally { this.working = false; }
    },
    openPreview(plugin: any, preview: any) {
      if (this.busy || !this.canRun) return;
      if (preview.package_sha256 !== plugin.package_sha256 || !(Date.parse(preview.expires_at) > Date.now())) {
        this.error = 'This action preview is expired or belongs to a different package. Refresh and run the plugin again.';
        return;
      }
      this.invocation = preview;
      this.invokedPlugin = plugin;
    },
    async invoke(plugin: any) {
      if (!this.canRun || this.busy || !plugin.enabled || plugin.revoked || plugin.consent_required) return;
      this.working = true;
      this.error = '';
      this.clearInvocation();
      try {
        const preview = (await getClient().req.post(`${this.path(plugin)}/invoke`, { package_sha256: plugin.package_sha256 })).data;
        if (preview.package_sha256 !== plugin.package_sha256 || !(Date.parse(preview.expires_at) > Date.now())) throw new Error('Invalid preview binding');
        this.invocation = preview;
        this.invokedPlugin = plugin;
      } catch (_) { this.error = 'Plugin did not return an action preview. Refresh its status before trying again.'; }
      finally { this.working = false; }
    },
  },
});
</script>

<style scoped>
.plugin-settings pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.plugin-settings article p { overflow-wrap: anywhere; }
</style>
