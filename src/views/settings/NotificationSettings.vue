<template lang="pug">
section(aria-labelledby="notification-history-title")
  h5#notification-history-title Local notification history
  p.small.text-muted Status: {{ capabilityStatus }}. History stays on this device and is available offline without an account.
  p.small Permission: Unknown. An attempted delivery does not confirm OS display or permission.
  div.d-flex.flex-wrap.mb-3
    b-button.mr-2.mb-2(variant="outline-secondary" :disabled="!canRead || store.loading" @click="refresh") Refresh
    b-button.mr-2.mb-2(variant="outline-danger" :disabled="!canRead || store.loading" @click="clearHistory") Clear history
    b-button.mb-2(variant="outline-secondary" to="/about") Get help
  p(role="status" aria-live="polite") {{ statusMessage }}
  p.text-danger(v-if="canRead && store.error" role="alert") {{ store.error }}
  ol.list-group(v-if="canRead && store.entries.length" aria-label="Local notification history, newest first")
    li.list-group-item(v-for="entry in store.entries" :key="entry.id")
      h6.mb-1 {{ entry.title }}
      p.mb-2 {{ entry.body }}
      p.small.text-muted.mb-2
        time(:datetime="entry.created_at") {{ formatDate(entry.created_at) }}
        |  · Delivery: {{ deliveryLabel(entry.delivery) }}
      b-button(size="sm" variant="outline-primary" :to="reviewRoute(entry.review_source)") Review source
  p.small.text-muted.mb-0 Up to 200 recent local notifications are kept in the encrypted vault. Clearing history does not change OS notification settings.
</template>

<script lang="ts">
import { useNotificationsStore, ReviewSource, NotificationEntry } from '~/stores/notifications';
import { useVaultStore } from '~/stores/vault';
import experience from '~/generated/product-experience.json';
import { capability } from '~/product/experience';

export default {
  name: 'NotificationSettings',
  props: { active: { type: Boolean, default: true } },
  data() {
    return { store: useNotificationsStore(), vaultStore: useVaultStore() };
  },
  computed: {
    canRead(): boolean { return this.vaultStore.isReady && this.store.nativeAvailable; },
    capabilityStatus(): string { return capability('notification-history', experience)?.status || 'Unavailable'; },
    statusMessage(): string {
      if (!this.store.nativeAvailable) return 'Open Notifications in PeakActivity desktop.';
      if (!this.vaultStore.isReady) return 'Unlock the local vault to view notification history.';
      if (this.store.loading) return 'Loading notification history…';
      if (this.store.error) return 'Notification history needs attention.';
      if (!this.store.loaded) return 'Refresh to load local notification history.';
      return this.store.entries.length ? `${this.store.entries.length} local notifications, newest first.` : 'No local notifications recorded. New desktop notices will appear here.';
    },
  },
  watch: {
    active: 'loadIfActive',
    'vaultStore.isReady': {
      immediate: true,
      handler(ready: boolean) {
        if (!ready) this.store.clearSensitive();
        else this.loadIfActive();
      },
    },
  },
  beforeDestroy() { this.store.$dispose(); },
  methods: {
    loadIfActive() { if (this.active && this.canRead && !this.store.loading) this.store.refresh(); },
    refresh() { if (this.canRead && !this.store.loading) return this.store.refresh(); },
    clearHistory() {
      if (this.canRead && !this.store.loading && window.confirm('Clear all notification history on this device? This cannot be undone.')) {
        return this.store.clear();
      }
    },
    reviewRoute(source: ReviewSource): string {
      return { home: '/home', privacy: '/settings/privacy', categorization: '/settings/categorization' }[source];
    },
    deliveryLabel(delivery: NotificationEntry['delivery']): string {
      return { unknown: 'Unknown', attempted: 'Attempted', failed: 'Failed', suppressed: 'Suppressed' }[delivery];
    },
    formatDate(value: string): string { return new Date(value).toLocaleString(); },
  },
};
</script>
