<template lang="pug">
b-modal(v-if="event && event.id", :id="'edit-modal-' + event.id", ref="eventEditModal", title="Edit event", centered, hide-footer)
  div(v-if="!editedEvent")
    | Loading event...

  div(v-else)
    b-alert(v-if="editError" show variant="danger") {{ editError }}
    table(style="width: 100%")
      tr
        th Bucket
        td {{ bucket_id }}
      tr
        th ID
        td {{ event.id }}
      tr
        th Start
        datetime(type="datetime" v-model="start")
      tr
        th End
        datetime(type="datetime" v-model="end")
      tr
        th Duration
        td {{ editedEvent.duration | friendlyduration }}

    hr

    table(style="width: 100%")
      tr
        th Key
        th Value
      tr(v-for="(v, k) in editedEvent.data" :key="k")
        td
          b-input(disabled, :value="k", size="sm")
        td
          b-checkbox(v-if="typeof event.data[k] === typeof true", v-model="editedEvent.data[k]", style="margin: 0.25em")
          b-input(v-if="typeof event.data[k] === typeof 'string'", v-model="editedEvent.data[k]", size="sm")
          b-input(v-if="typeof event.data[k] === 'number'", v-model.number="editedEvent.data[k]", size="sm", type="number")

    hr

    section.mt-3(v-if="canCreateCategoryRule" aria-labelledby="corrected-category-rule-title")
      h5#corrected-category-rule-title Create a category rule from this correction
      p.small.text-muted Uses one corrected application or title value as an exact local rule. It changes category rules, not event data; save the event separately if you edited it.
      b-form-group(label="Category")
        b-form-select(v-model="selectedRuleCategory" :options="categoryOptions")
      b-form-group(label="Corrected field")
        b-form-select(v-model="ruleField" :options="ruleFieldOptions")
      p.small.text-muted(v-if="rulePattern") Rule preview: {{ rulePattern }}
      b-button(size="sm" variant="outline-primary" :disabled="!selectedRuleCategory.length || !rulePattern" @click="createCategoryRule") Add rule from correction
      p.small.text-success(role="status" v-if="ruleSaved") Rule saved. Recalculate the local report to see its category result.

    b-button(size="sm" variant="outline-secondary" :disabled="busy" @click="loadHistory") Show correction history
    p.small.text-muted.mt-2(v-if="historyLoaded && corrections.length === 0") No corrections recorded.
    ul.mt-2(v-if="corrections.length")
      li(v-for="(correction, index) in corrections" :key="index")
        | {{ moment(correction.corrected_at).format('YYYY-MM-DD HH:mm:ss') }} — {{ correction.fields.join(', ') }} ({{ sourceLabel(correction.source) }})

    section.mt-3(v-if="canSplit" aria-labelledby="split-event-title")
      h5#split-event-title Split activity
      label.d-block(for="event-split-at") Split at
      datetime#event-split-at(type="datetime" v-model="splitAt")
      p.small.text-muted The original event is replaced by two events. Correction history will show the split without storing old or new values.
      b-button.mx-1(:disabled="busy" @click="split" variant="outline-primary") Split event

    b-button.mx-1(v-if="mergeCandidate" :disabled="busy" @click="merge" variant="outline-primary") Merge adjacent activities

    div.float-left
      b-button.mx-1(:disabled="busy" @click="delete_" variant="danger")
        icon.mx-1(name="trash")
        | Delete
    div.float-right
      b-button.mx-1(:disabled="busy" @click="close")
        icon.mx-1(name="times")
        | Cancel
      b-button.mx-1(:disabled="busy" @click="save" variant="primary")
        icon.mx-1(name="save")
        | {{ busy ? 'Saving…' : 'Save' }}
</template>

<style lang="scss"></style>

<script lang="ts">
// This EventEditor can be used to edit events in a specific bucket.
//
// It is used in:
//  - Stopwatch
//  - Bucket viewer
//  - Timeline (on event-click)
//  - Search (soon)

import moment from 'moment';
import _ from 'lodash';
import { useCategoryStore } from '~/stores/categories';
import { buildExactRulePattern } from '~/util/categorization';

import 'vue-awesome/icons/times';
import 'vue-awesome/icons/save';
import 'vue-awesome/icons/trash';

export default {
  name: 'EventEditor',
  props: {
    event: { type: Object },
    bucket_id: { type: String, required: true },
    events: { type: Array, default: () => [] },
  },
  data() {
    return {
      moment,
      categoryStore: useCategoryStore(),
      editedEvent: null,
      corrections: [],
      splitAt: '',
      historyLoaded: false,
      busy: false,
      editError: '',
      ruleField: '',
      selectedRuleCategory: [] as string[],
      ruleSaved: false,
    };
  },
  computed: {
    canCreateCategoryRule(): boolean {
      return this.bucket_id.startsWith('aw-watcher-window_') && this.ruleFieldOptions.length > 0;
    },
    categoryOptions() {
      return [
        { value: [], text: 'Select a category…', disabled: true },
        ...this.categoryStore.allCategoriesSelect,
      ];
    },
    ruleFieldOptions() {
      const data = this.editedEvent?.data || {};
      return ['app', 'title']
        .filter(field => typeof data[field] === 'string' && data[field].trim())
        .map(field => ({
          value: field,
          text: field === 'app' ? 'Application name' : 'Window title',
        }));
    },
    rulePattern(): string | null {
      return buildExactRulePattern(this.editedEvent?.data?.[this.ruleField]);
    },
    canSplit(): boolean {
      return (
        !!this.editedEvent?.id &&
        this.editedEvent.duration >= 0.002 &&
        !(this.bucket_id === 'aw-stopwatch' && this.editedEvent.data?.running === true)
      );
    },
    mergeCandidate(): any | null {
      const current = this.editedEvent;
      if (
        !current?.id ||
        !Array.isArray(this.events) ||
        (this.bucket_id === 'aw-stopwatch' && current.data?.running === true)
      )
        return null;
      const start = moment(current.timestamp).valueOf();
      const end = moment(current.timestamp).add(current.duration, 'seconds').valueOf();
      const neighbors = this.events.filter(
        (event: any) => event.id !== current.id && _.isEqual(event.data, current.data)
      );
      const previous = neighbors.find(
        (event: any) => moment(event.timestamp).add(event.duration, 'seconds').valueOf() === start
      );
      if (previous) return previous;
      const next = neighbors.find((event: any) => moment(event.timestamp).valueOf() === end);
      return next || null;
    },
    start: {
      get: function () {
        return moment(this.editedEvent.timestamp).format();
      },
      set: function (dt) {
        // Duration needs to be set first since otherwise the computed for end will use the new timestamp
        this.editedEvent.duration = moment(this.end).diff(dt, 'seconds');
        this.editedEvent.timestamp = new Date(dt);
      },
    },
    end: {
      get: function () {
        const end = moment(this.editedEvent.timestamp).add(this.editedEvent.duration, 'seconds');
        return end.format();
      },
      set: function (dt) {
        this.editedEvent.duration = moment(dt).diff(this.editedEvent.timestamp, 'seconds');
      },
    },
  },
  watch: {
    async event() {
      this.corrections = [];
      this.historyLoaded = false;
      this.editError = '';
      this.ruleSaved = false;
      await this.getEvent();
    },
    ruleField() {
      this.ruleSaved = false;
    },
    selectedRuleCategory() {
      this.ruleSaved = false;
    },
  },
  mounted: async function () {
    await this.getEvent();
  },
  methods: {
    sourceLabel(source: string): string {
      const labels: Record<string, string> = {
        'local-ui': 'Manual edit',
        'local-api': 'Local API',
        'local-ui-split': 'Split event',
        'local-ui-merge': 'Merge adjacent activities',
      };
      return labels[source] || 'Other';
    },
    async save() {
      if (!this.editedEvent || this.busy) return;
      this.busy = true;
      this.editError = '';
      try {
        const result = await this.$aw.req.put(
          `/0/buckets/${encodeURIComponent(this.bucket_id)}/events/${this.editedEvent.id}`,
          this.editedEvent
        );
        this.$emit('save', result.data);
        this.close();
      } catch (error) {
        this.editError = error?.response?.data?.message || 'The correction was not saved.';
      } finally {
        this.busy = false;
      }
    },
    async delete_() {
      if (!this.event || this.busy || !window.confirm('Delete this event permanently?')) return;
      this.busy = true;
      this.editError = '';
      try {
        await this.$aw.req.delete(
          `/0/buckets/${encodeURIComponent(this.bucket_id)}/events/${this.event.id}`
        );
        this.$emit('delete', this.event);
        this.close();
      } catch (error) {
        this.editError = error?.response?.data?.message || 'The event was not deleted.';
      } finally {
        this.busy = false;
      }
    },
    async loadHistory() {
      if (!this.event?.id) return;
      this.editError = '';
      try {
        const result = await this.$aw.req.get(
          `/0/buckets/${encodeURIComponent(this.bucket_id)}/events/${this.event.id}/corrections`
        );
        this.corrections = result.data;
        this.historyLoaded = true;
      } catch (error) {
        this.editError =
          error?.response?.data?.message || 'Correction history could not be loaded.';
      }
    },
    async getEvent() {
      if (this.bucket_id && this.event && this.event.id) {
        this.editedEvent = await this.$aw.getEvent(this.bucket_id, this.event.id);
        this.splitAt = moment(this.editedEvent.timestamp)
          .add(this.editedEvent.duration / 2, 'seconds')
          .format();
        const fields = this.ruleFieldOptions.map(option => option.value);
        if (!fields.includes(this.ruleField)) this.ruleField = fields[0] || '';
      } else {
        this.editedEvent = null;
        this.splitAt = '';
      }
    },
    async createCategoryRule() {
      if (!this.canCreateCategoryRule || !this.rulePattern || !this.selectedRuleCategory.length)
        return;
      this.editError = '';
      this.ruleSaved = false;
      const category = this.categoryStore.get_category(this.selectedRuleCategory);
      if (!category || category.id === undefined) {
        this.editError = 'Choose an existing category before creating a rule.';
        return;
      }
      this.categoryStore.appendClassRule(category.id, this.rulePattern);
      try {
        await this.categoryStore.save();
        this.ruleSaved = true;
      } catch {
        this.editError = 'The category rule could not be saved.';
      }
    },
    async split() {
      if (!this.canSplit || this.busy) return;
      const start = moment(this.editedEvent.timestamp);
      const end = start.clone().add(this.editedEvent.duration, 'seconds');
      const splitAt = moment(this.splitAt);
      if (
        !splitAt.isValid() ||
        splitAt.valueOf() <= start.valueOf() ||
        splitAt.valueOf() >= end.valueOf()
      ) {
        this.editError = 'Choose a split time inside the event.';
        return;
      }
      if (
        !window.confirm(
          'Split this event into two activities? The original event will be replaced.'
        )
      )
        return;
      this.busy = true;
      this.editError = '';
      try {
        const result = await this.$aw.req.post(
          `/0/buckets/${encodeURIComponent(this.bucket_id)}/events/${this.editedEvent.id}/split`,
          { split_at: splitAt.toDate().toISOString() }
        );
        this.$emit('split', result.data);
        this.close();
      } catch (error) {
        this.editError = error?.response?.data?.message || 'The event was not split.';
      } finally {
        this.busy = false;
      }
    },
    async merge() {
      if (!this.mergeCandidate || this.busy) return;
      if (!window.confirm('Merge these adjacent activities? The original events will be replaced.'))
        return;
      this.busy = true;
      this.editError = '';
      try {
        const otherId = this.mergeCandidate.id;
        const result = await this.$aw.req.post(
          `/0/buckets/${encodeURIComponent(this.bucket_id)}/events/${
            this.editedEvent.id
          }/merge/${otherId}`
        );
        this.$emit('merge', result.data);
        this.close();
      } catch (error) {
        this.editError = error?.response?.data?.message || 'The activities were not merged.';
      } finally {
        this.busy = false;
      }
    },
    close() {
      this.$refs.eventEditModal.hide();
      this.$emit('close', this.event);
    },
  },
};
</script>
