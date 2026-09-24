<template lang="pug">
div
  h3 {{ id }}
  table
    tr
      th Type:
      td {{ bucket.type }}
    tr
      th Client:
      td {{ bucket.client }}
    tr
      th Hostname:
      td {{ bucket.hostname }}
    tr
      th Created:
      td {{ bucket.created | iso8601 }}
    tr(v-if="bucket.metadata")
      th First/last event:
      td
        | {{ bucket.metadata.start}} /
        | {{ bucket.metadata.end }}
    tr
      th Eventcount:
      td {{ eventcount }}
    tr
      th Data:
      td {{ bucket.data }}

  input-timeinterval(v-model="daterange", :maxDuration="maxDuration")
  b-button.ml-2(variant="outline-danger" :disabled="!daterange || deletingRange" @click="$root.$emit('bv::show::modal', 'delete-bucket-range')") Delete events in range
  b-alert.mt-2(v-if="rangeDeleteError" show variant="danger") {{ rangeDeleteError }}
  b-alert.mt-2(v-if="rangeDeleteCount !== null" show variant="success") Deleted {{ rangeDeleteCount }} events.

  vis-timeline(:buckets="[bucket_with_events]", :showRowLabels="false" @events-transformed="updateEvent")

  aw-eventlist(:bucket_id="id", @save="updateEvent", @delete="updateEvent", @split="updateEvent", @merge="updateEvent", :events="events" editable=true)

  b-modal(id="delete-bucket-range" title="Delete events in this time range?" centered hide-footer)
    p This permanently deletes every event that overlaps or touches the selected interval, plus its correction history.
    p(v-if="daterange") {{ daterange[0].format() }} to {{ daterange[1].format() }}
    b-alert(v-if="rangeDeleteError" show variant="danger") {{ rangeDeleteError }}
    div.text-right
      b-button.mr-2(:disabled="deletingRange" @click="$root.$emit('bv::hide::modal', 'delete-bucket-range')") Cancel
      b-button(variant="danger" :disabled="deletingRange || !daterange" @click="deleteRange")
        | {{ deletingRange ? 'Deleting…' : 'Delete selected events' }}
</template>

<script lang="ts">
import { useBucketsStore } from '~/stores/buckets';
import { getClient } from '~/util/awclient';

export default {
  name: 'Bucket',
  props: {
    id: String,
  },
  data: () => {
    return {
      bucketsStore: useBucketsStore(),

      events: [],
      eventcount: '?',
      daterange: null,
      maxDuration: 31 * 24 * 60 * 60,
      deletingRange: false,
      rangeDeleteError: '',
      rangeDeleteCount: null,
    };
  },
  computed: {
    bucket() {
      return this.bucketsStore.getBucket(this.id) || { id: this.id };
    },
    bucket_with_events() {
      console.log(this.bucket);
      return {
        ...this.bucket,
        events: this.events,
      };
    },
  },
  watch: {
    daterange: async function () {
      await this.getEvents(this.id);
    },
  },
  mounted: async function () {
    await this.bucketsStore.ensureLoaded();
    await this.getEventCount(this.id);
  },
  methods: {
    getEvents: async function (bucket_id) {
      const bucket = await this.bucketsStore.getBucketWithEvents({
        id: bucket_id,
        start: this.daterange[0].format(),
        end: this.daterange[1].format(),
      });
      this.events = bucket.events;
    },
    getEventCount: async function (bucket_id) {
      this.eventcount = (await getClient().countEvents(bucket_id)).data;
    },
    updateEvent: async function () {
      await this.getEvents(this.id);
      await this.getEventCount(this.id);
    },
    deleteRange: async function () {
      if (!this.daterange || this.deletingRange) return;
      this.deletingRange = true;
      this.rangeDeleteError = '';
      this.rangeDeleteCount = null;
      try {
        const response = await this.$aw.req.delete(`/0/buckets/${encodeURIComponent(this.id)}/events`, {
          params: { start: this.daterange[0].format(), end: this.daterange[1].format() },
        });
        this.rangeDeleteCount = response.data;
        this.$root.$emit('bv::hide::modal', 'delete-bucket-range');
        await this.getEvents(this.id);
        await this.getEventCount(this.id);
      } catch (error) {
        this.rangeDeleteError = this.rangeDeleteCount === null
          ? error?.response?.data?.message || 'Events in this range were not deleted.'
          : 'Events were deleted, but the refreshed event list could not be loaded.';
      } finally {
        this.deletingRange = false;
      }
    },
  },
};
</script>
