<template lang="pug">
main
  h1 Home / Today
  p {{ todayLabel }}
  p Local Vault: {{ vaultLabel }} · Device: {{ deviceScope }}
  p(role="status" aria-live="polite") {{ capture.label }}
  p.text-muted Source health: {{ sourceHealth }}
  p(v-if="capture.policy") {{ sourceSummary }}
  p(v-if="capture.error" role="alert") {{ capture.error }}
  p PeakActivity keeps your activity in the Local Vault on this device. Review your local activity and choose when recording starts.
  p.text-muted This is a development build. Use synthetic activity until privacy and platform checks are complete.
  p(v-if="historyError" role="alert") {{ historyError }}
  p(v-else-if="loadingHistory" role="status") Loading today's local summary…
  section(v-else aria-labelledby="today-summary-title")
    h2#today-summary-title.h5 Today's local summary
    p Active time: #[b {{ (activity.active.duration || 0) | friendlyduration }}]
    div.row(v-if="isShipped('insights-reports')")
      section.col-md-6(aria-labelledby="today-apps-title")
        h3#today-apps-title.h6 Top applications
        small.text-muted(v-if="statusLabel('insights-reports')") {{ statusLabel('insights-reports') }}
        ul(v-if="topApps.length")
          li(v-for="app in topApps" :key="app.label") {{ app.label }} — {{ app.duration | friendlyduration }}
        p.text-muted(v-else) No application activity recorded for this period.
      section.col-md-6(aria-labelledby="today-categories-title")
        h3#today-categories-title.h6 Top categories
        small.text-muted(v-if="statusLabel('insights-reports')") {{ statusLabel('insights-reports') }}
        ul(v-if="topCategories.length")
          li(v-for="category in topCategories" :key="category.label") {{ category.label }} — {{ category.duration | friendlyduration }}
        p.text-muted(v-else) No categorized activity recorded for this period.
      section.col-md-6(v-if="isShipped('manual-time-entry')" aria-labelledby="today-manual-title")
        h3#today-manual-title.h6 Manual time entries
        small.text-muted(v-if="statusLabel('manual-time-entry')") {{ statusLabel('manual-time-entry') }}
        ul(v-if="topManualEntries.length")
          li(v-for="entry in topManualEntries" :key="entry.label") {{ entry.label }} — {{ entry.duration | friendlyduration }}
        p.text-muted(v-else) No manual time entries recorded for this period.
    p.small.text-muted Summary uses application names, categories, and manual time labels. Window titles, URLs, and paths are not shown here.
  nav(aria-label="PeakActivity destinations")
    ul
      li(v-for="destination in destinations" :key="destination.to")
        router-link(:to="destination.to") {{ destination.label }}
        small.ml-1.text-muted(v-if="destination.status") ({{ destination.status }})
</template>

<script lang="ts">
import { useCaptureStore } from '~/stores/capture';
import { useActivityStore } from '~/stores/activity';
import { useBucketsStore } from '~/stores/buckets';
import { useServerStore } from '~/stores/server';
import { useSettingsStore } from '~/stores/settings';
import { useVaultStore } from '~/stores/vault';
import experience from '~/generated/product-experience.json';
import { isShipped, statusLabel } from '~/product/experience';
import { get_today_with_offset } from '~/util/time';

export default {
  name: 'Home',
  data() { return { capture: useCaptureStore(), activity: useActivityStore(), vault: useVaultStore(), loadingHistory: false, historyError: '' }; },
  computed: {
    destinations() {
      return [
        { to: '/timeline', label: 'Timeline', capability: 'web-interface' },
        { to: '/work-report', label: 'Reports', capability: 'insights-reports' },
        { to: '/freelancer', label: 'Projects and timesheets', capability: 'freelancer-workspace' },
        { to: '/stopwatch', label: 'Manual timer', capability: 'manual-time-entry' },
        { to: '/settings/privacy', label: 'Privacy', capability: 'local-capture' },
        { to: '/buckets', label: 'Local data', capability: 'local-api' },
        { to: '/about', label: 'About, source, and legal', capability: 'desktop' },
      ].filter(destination => isShipped(destination.capability, experience))
        .map(destination => ({ ...destination, status: statusLabel(destination.capability, experience) }));
    },
    todayLabel(): string {
      const date = get_today_with_offset(useSettingsStore().startOfDay);
      const [year, month, day] = date.split('-').map(Number);
      return new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date(year, month - 1, day, 12));
    },
    isShipped(): (id: string) => boolean { return id => isShipped(id, experience); },
    statusLabel(): (id: string) => string { return id => statusLabel(id, experience); },
    sourceSummary(): string {
      const policy = this.capture.policy;
      const sources = [];
      if (policy.window) sources.push('applications and windows');
      if (policy.idle) sources.push('active and idle status');
      if (policy.browser) sources.push('browser windows');
      return `Enabled sources: ${sources.length ? sources.join(', ') : 'none'}.`;
    },
    sourceHealth(): string {
      if (this.capture.error) return 'Unavailable — recording status could not be verified.';
      if (!this.capture.recording) return 'Sources are stopped while recording is off, paused, or in Private Mode.';
      const expected = this.capture.runtime.expected;
      return expected.length && expected.every(name => this.capture.runtime.modules[name] === true)
        ? 'Available'
        : 'Source unavailable — check permissions and retry.';
    },
    vaultLabel(): string {
      return this.vault.status?.state === 'ready' ? 'Unlocked' : 'Locked or unavailable';
    },
    deviceScope(): string {
      if (useSettingsStore().useMultidevice) return 'All available local devices';
      return useServerStore().info?.hostname || 'This device';
    },
    topApps(): { label: string; duration: number }[] {
      return (this.activity.window.top_apps || []).slice(0, 5).map(event => ({
        label: typeof event.data.app === 'string' ? event.data.app : 'Application',
        duration: event.duration,
      }));
    },
    topCategories(): { label: string; duration: number }[] {
      return (this.activity.category.top || []).slice(0, 5).map(event => ({
        label: Array.isArray(event.data.$category) ? event.data.$category.join(' > ') : 'Uncategorized',
        duration: event.duration,
      }));
    },
    topManualEntries(): { label: string; duration: number }[] {
      return (this.activity.stopwatch.top_stopwatches || []).slice(0, 5).map(event => ({
        label: typeof event.data.label === 'string' ? event.data.label : 'Manual time entry',
        duration: event.duration,
      }));
    },
  },
  async mounted() {
    this.loadingHistory = true;
    try {
      const settings = useSettingsStore();
      await settings.ensureLoaded();
      const buckets = useBucketsStore();
      await buckets.ensureLoaded();
      const host = useServerStore().info?.hostname || buckets.hosts[0];
      if (host) {
        await this.activity.ensure_loaded({ host, date: get_today_with_offset(settings.startOfDay), include_stopwatch: true });
      }
    } catch (_) {
      this.historyError = 'Today’s local summary is unavailable. Open Timeline to retry the local history query.';
    } finally {
      this.loadingHistory = false;
    }
  },
};
</script>
