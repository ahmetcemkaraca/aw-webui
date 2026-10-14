<template lang="pug">
section.mb-4(aria-labelledby="backup-catalogue-title")
  h5#backup-catalogue-title Encrypted backup versions
  p.text-muted Local browsing and export are free. Creating a snapshot, selecting an existing version, and sending it to a provider are separate actions.
  p.text-danger(v-if="backups.error" role="alert") {{ backups.error }}
  p.text-success(v-if="backups.restored" role="status") Selected backup restored. Review recovered settings before enabling recording or sync.
  label(for="backup-source") Backup source
  select#backup-source.form-control.mb-2(:value="backups.mode" :disabled="disabled" @change="edit('mode', $event.target.value)")
    option(value="local") Local encrypted vault
    option(value="folder") Existing backup folder
  div(v-if="backups.mode === 'folder'")
    label(for="backup-folder") Backup folder path
    input#backup-folder.form-control.mb-2(:value="backups.folderPath" :disabled="disabled" @input="edit('folderPath', $event.target.value)" autocomplete="off")
  details.mb-3
    summary Use a saved recovery kit for historical keys
    label.mt-2(for="backup-kit") Encrypted recovery kit JSON
    textarea#backup-kit.form-control(:value="backups.kitRaw" :disabled="disabled" @input="edit('kitRaw', $event.target.value)" rows="3" autocomplete="off")
    label.mt-2(for="backup-phrase") Recovery phrase
    input#backup-phrase.form-control(:value="backups.phrase" :disabled="disabled" @input="edit('phrase', $event.target.value)" type="password" autocomplete="off")
    p.small.text-muted The kit and phrase stay in this screen until cleared. Browsing does not install their keys.
  button.btn.btn-outline-secondary.mr-2(type="button" data-backup-list :disabled="disabled" @click="backups.load()") List existing versions
  button.btn.btn-outline-primary(type="button" data-backup-create :disabled="disabled || backups.mode !== 'local'" @click="backups.create()") Create a new local snapshot
  p.mt-2(v-if="backups.busy" role="status") Checking encrypted backup metadata…
  div.mt-3(v-if="backups.catalogue")
    p.text-warning(v-if="backups.catalogue.requires_recovery_kit") A matching recovery kit is required to authenticate these objects.
    p.small(v-if="backups.catalogue.invalid_object_count") {{ backups.catalogue.invalid_object_count }} objects could not be authenticated.
    ul.small(v-if="backups.catalogue.namespaces.length")
      li(v-for="(namespace, index) in backups.catalogue.namespaces" :key="index") Epoch {{ namespace.key_epoch }}: {{ namespace.object_count }} encrypted objects {{ namespace.vault_id === backups.catalogue.vault_id && namespace.key_epoch === backups.catalogue.key_epoch ? '— matching key used' : '— matching key unavailable' }}
    p.text-muted(v-if="!backups.versions.length") No authenticated snapshot versions are available in this source.
  ul.list-unstyled.mt-3
    li.mb-3(v-for="row in backups.versions" :key="row.snapshot_id")
      strong.d-block {{ statusLabel(row.status) }} · epoch {{ row.key_epoch }} · {{ row.object_count }} objects
      span.small.d-block(v-if="row.status === 'forgotten'") {{ row.observed_object_count }} objects observed in this source; other copies may remain.
      span.small.d-block(v-if="row.current") Current snapshot — protected from deletion
      span.small.font-monospace.d-block {{ row.snapshot_id }}
      p.small.mb-1(v-if="row.status === 'authenticated'") Verified payload range: {{ row.query_start || 'No activity events' }} → {{ row.query_end || 'No activity events' }} · {{ row.event_count }} events
      button.btn.btn-outline-primary.btn-sm(type="button" data-backup-select :disabled="disabled || !row.selection" @click="backups.select(row)") {{ backups.selected?.snapshot_id === row.snapshot_id ? 'Selected' : 'Select this version' }}
      button.btn.btn-outline-danger.btn-sm.ml-2(type="button" data-backup-delete-select :disabled="disabled || row.current || !row.deletion_selection" @click="backups.selectDeletion(row)") Review deleting this copy
  div.mt-3(v-if="backups.deletionSelected")
    p Deletion selected: {{ backups.deletionSelected.snapshot_id }}
    button.btn.btn-outline-danger(type="button" data-backup-delete-preview :disabled="disabled" @click="remoteDeletion ? review('delete') : backups.previewDelete()") Review {{ remoteDeletion ? 'provider' : backups.mode }} deletion
  div.mt-3(v-if="backups.deletePreview" aria-label="Backup deletion review")
    h6 Delete selected historical copy
    p {{ backups.deletePreview.object_count }} encrypted objects in {{ backups.deletePreview.copy_scope }}. Other copies are not removed by this action.
    p(v-if="backups.deletePreview.retry") This is a retry of the same protected deletion intent.
    label.d-block
      input.mr-2(type="checkbox" v-model="deleteAccepted" :disabled="disabled")
      | I reviewed this copy and accept deleting it.
    button.btn.btn-danger(type="button" data-backup-delete :disabled="disabled || !deleteAccepted" @click="backups.deleteSelected(deleteAccepted)") Delete reviewed copy
  div.mt-3(v-if="backups.deleteOutcome" role="status")
    p {{ backups.deleteOutcome.deleted }} deleted · {{ backups.deleteOutcome.absent }} observed absent · {{ backups.deleteOutcome.conflict }} changed · {{ backups.deleteOutcome.failed }} failed · {{ backups.deleteOutcome.unknown }} unknown.
    p(v-if="!backups.deleteOutcome.durable") Durable removal has not been confirmed for this copy. Other copies may remain.
    button.btn.btn-outline-danger(type="button" data-backup-delete-retry :disabled="disabled || !backups.deletionSelected" @click="remoteDeletion ? review('delete') : backups.previewDelete()") Review this copy again
  p.small.text-muted Object order does not establish backup chronology. This list does not prove complete provider history.
  div(v-if="backups.selected")
    p Selected snapshot: {{ backups.selected.snapshot_id }}
    button.btn.btn-outline-secondary.mr-2(type="button" data-backup-export :disabled="disabled || remoteSelection" @click="backups.exportSelected()") Export selected encrypted JSON
    button.btn.btn-outline-primary(type="button" data-backup-restore-preview :disabled="disabled || remoteSelection || !backups.kitRaw || !backups.phrase" @click="backups.previewRestore()") Preview selected restore
    p.small.text-muted(v-if="remoteSelection") Download this selected provider version before local export or restore.
  div.mt-3(v-if="backups.exportRaw")
    label(for="backup-export") Selected encrypted snapshot JSON
    textarea#backup-export.form-control(:value="backups.exportRaw" rows="5" readonly spellcheck="false")
  div.mt-3(v-if="backups.restorePreview" aria-label="Selected backup restore preview")
    h6 Restore selected version
    p Restore requires an empty activity vault with recording paused. Current settings stay active until reviewed.
    p {{ backups.restorePreview.object_count }} encrypted objects · epoch {{ backups.restorePreview.key_epoch }} · {{ backups.restorePreview.policy_conflict_count }} settings or policy fields to review
    p Verified payload range: {{ backups.restorePreview.query_start || 'No activity events' }} → {{ backups.restorePreview.query_end || 'No activity events' }}
    label.d-block
      input.mr-2(type="checkbox" v-model="restoreAccepted" :disabled="disabled")
      | I reviewed this version and accept restoring it to this empty vault.
    button.btn.btn-danger(type="button" data-backup-restore :disabled="disabled || !restoreAccepted" @click="backups.restoreSelected(restoreAccepted)") Restore selected version
  hr
  h6 Provider backups
  p.small.text-muted(v-if="!capabilityReady") Provider transfer is {{ capabilityStatus }}. Local backup controls remain available.
  button.btn.btn-outline-secondary(type="button" :disabled="disabled || !capabilityReady" @click="backups.refreshProvider()") Check provider availability
  p.small.text-muted(v-if="capabilityReady && !backups.providerAllowed") Provider transfer requires paid sync access, a trusted signed destination and the Privacy Firewall enabled.
  label.mt-2(for="backup-destination") Signed provider destination
  select#backup-destination.form-control(:value="destination" :disabled="disabled || !cleanupReady" @change="destination = $event.target.value; clearProviderReview()")
    option(value="") Select a destination
    option(v-for="item in backups.destinations" :key="item" :value="item") {{ item }}
  button.btn.btn-outline-secondary.mt-2.mr-2(type="button" data-backup-cleanup :disabled="disabled || !cleanupReady || !destination" @click="review('cleanup_list')") Review free provider cleanup discovery
  button.btn.btn-outline-primary.mt-2.mr-2(type="button" data-backup-provider :disabled="disabled || !providerReady || !destination" @click="review('list')") Review provider discovery
  button.btn.btn-outline-primary.mt-2(type="button" :disabled="disabled || !providerReady || !destination || !backups.selected" @click="review(remoteSelection ? 'download' : 'upload')") Review selected {{ remoteSelection ? 'download' : 'upload' }}
  div.mt-3(v-if="backups.providerPreview" aria-label="Provider backup review")
    h6 Review {{ backups.providerPreview.operation }}
    p Destination: {{ backups.providerPreview.destination_id }} · purpose: encrypted backup objects
    p Retention: {{ backups.providerPreview.retention_disclosure }}
    p Epoch {{ backups.providerPreview.key_epoch }} · {{ backups.providerPreview.object_count }} selected ciphertext objects · expires {{ backups.providerPreview.expires_at }}
    label.d-block
      input.mr-2(type="checkbox" v-model="providerAccepted" :disabled="disabled")
      | I reviewed this operation and allow this provider request.
    button.btn.btn-primary(type="button" data-backup-transfer :disabled="disabled || !reviewReady || !providerAccepted" @click="backups.runProvider(providerAccepted)") Run reviewed operation
  p.mt-2(v-if="backups.transfer" role="status") {{ backups.transfer.status === 'complete' ? 'Transfer complete' : 'Transfer interrupted — review again to retry' }}: {{ backups.transfer.completed_objects }} / {{ backups.transfer.object_count }} objects. {{ backups.transfer.status === 'partial' ? 'No partial download was saved locally.' : '' }}
  button.btn.btn-outline-secondary.mt-3(type="button" :disabled="!active" @click="backups.clearSensitive()") Clear backup inputs and results
</template>
<script lang="ts">
import { useBackupStore } from '~/stores/backups';
import experience from '~/generated/product-experience.json';
import { capability } from '~/product/experience';
export default {
  name: 'SyncBackupCatalogue',
  props: { active: { type: Boolean, default: true } },
  data() {
    return {
      backups: useBackupStore(),
      restoreAccepted: false,
      deleteAccepted: false,
      providerAccepted: false,
      destination: '',
    };
  },
  computed: {
    disabled(): boolean {
      return !this.active || this.backups.busy;
    },
    remoteSelection(): boolean {
      return !!this.backups.selected?.source_id.startsWith('relay-');
    },
    remoteDeletion(): boolean {
      return !!this.backups.deletionSelected?.source_id.startsWith('relay-');
    },
    cleanupReady(): boolean {
      return this.capabilityReady && this.backups.cleanupAllowed;
    },
    reviewReady(): boolean {
      return ['cleanup_list', 'delete'].includes(this.backups.providerPreview?.operation)
        ? this.cleanupReady
        : this.providerReady;
    },
    capabilityStatus(): string {
      return capability('e2ee-sync', experience)?.status || 'Unavailable';
    },
    capabilityReady(): boolean {
      return ['Available', 'Beta', 'Experimental'].includes(this.capabilityStatus);
    },
    providerReady(): boolean {
      return this.capabilityReady && this.backups.providerAllowed;
    },
  },
  watch: {
    active(value: boolean) {
      if (!value) {
        this.backups.clearSensitive();
        this.destination = '';
      }
    },
    'backups.deletePreview'() {
      this.deleteAccepted = false;
    },
    'backups.restorePreview'() {
      this.restoreAccepted = false;
    },
    'backups.providerPreview'() {
      this.providerAccepted = false;
    },
  },
  beforeDestroy() {
    this.backups.clearSensitive();
  },
  methods: {
    edit(field: string, value: string) {
      this.backups.configure({
        mode: this.backups.mode,
        folderPath: this.backups.folderPath,
        kitRaw: this.backups.kitRaw,
        phrase: this.backups.phrase,
        [field]: value,
      });
    },
    statusLabel(status: string): string {
      return (
        {
          authenticated: 'Authenticated',
          forgotten: 'Forgotten — remaining copies require cleanup',
          incomplete: 'Incomplete',
          invalid_recovery: 'Invalid recovery payload',
        }[status] || 'Unavailable'
      );
    },
    clearProviderReview() {
      this.backups.providerPreview = null;
      this.providerAccepted = false;
    },
    async review(operation: 'list' | 'cleanup_list' | 'delete' | 'upload' | 'download') {
      if (
        this.disabled ||
        !(['cleanup_list', 'delete'].includes(operation) ? this.cleanupReady : this.providerReady)
      )
        return;
      await this.backups.reviewProvider(operation, this.destination);
    },
  },
};
</script>
