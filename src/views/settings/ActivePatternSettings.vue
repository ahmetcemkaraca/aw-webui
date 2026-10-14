<template lang="pug">
div
  div.d-sm-flex.justify-content-between
    div
      h5.mb-2.mb-sm-0 Always count as active pattern

      small.text-muted
        | Apps or titles matching this regular expression will never be counted as AFK.
        |
        | Can be used to count time as active, despite no input (like meetings, or games with controllers). An empty string disables it.
        |
        span.text-nowrap
          | Example expression:&nbsp;
          code(style="background-color: rgba(200, 200, 200, 0.3); padding: 2px 4px; border-radius: 2px;")
            | Zoom Meeting|Google Meet|Microsoft Teams
    div
      small.text-danger(v-if="patternError" role="alert") {{ patternError }}
      b-form-input(size="sm" v-model="always_active_pattern_editing" :state="(enabled || null) && valid")
      small.text-right
        div.text-success(v-if="enabled && valid") Enabled
        div.text-danger(v-else-if="enabled") Invalid pattern
        div.text-muted(v-else) Disabled
        div.text-danger(v-if="enabled && valid && broad_pattern") Pattern too broad

</template>

<script lang="ts">
import { registerPolicyDraft } from '~/util/policyDrafts';
import { isRegexBroad, validateRegex } from '~/util/validate';
import { useSettingsStore } from '~/stores/settings';

export default {
  name: 'ActivePatternSettings',
  data() {
    return {
      settingsStore: useSettingsStore(),
      always_active_pattern_editing: '',
      savedPattern: '',
      patternSaving: 0,
      patternError: '',
      unregisterPolicyDraft: null,
    };
  },
  computed: {
    enabled: function () {
      return this.always_active_pattern_editing != '';
    },
    valid: function () {
      return validateRegex(this.always_active_pattern_editing);
    },
    broad_pattern: function () {
      // Check if the pattern matches random strings that we don't expect it to
      // like the alphabet
      const pattern = this.always_active_pattern_editing;
      if (pattern == '') {
        return false;
      }
      return isRegexBroad(pattern);
    },
    always_active_pattern: {
      get() {
        return this.settingsStore.always_active_pattern;
      },
      set(value) {
        void this.savePattern(value);
      },
    },
  },
  watch: {
    always_active_pattern_editing: function (value) {
      if (value == this.always_active_pattern) {
        return;
      }

      if (
        (value != '' && this.valid) ||
        (value == '' && this.settingsStore.always_active_pattern.length != 0)
      ) {
        this.always_active_pattern = value;
      }
    },
  },
  mounted() {
    this.savedPattern = this.settingsStore.always_active_pattern;
    this.always_active_pattern_editing = this.savedPattern;
    this.unregisterPolicyDraft = registerPolicyDraft(['settings.always_active_pattern'], {
      blocked: () => this.patternSaving > 0 || this.always_active_pattern_editing !== this.savedPattern,
      reload: async owned => { if (await owned()) { this.savedPattern = this.settingsStore.always_active_pattern; this.always_active_pattern_editing = this.savedPattern; } },
    });
  },
  beforeDestroy() { this.unregisterPolicyDraft?.(); },
  methods: {
    async savePattern(value: string) {
      this.patternSaving++; this.patternError = '';
      try { await this.settingsStore.update({always_active_pattern:value}); this.savedPattern = value; }
      catch (_) { this.patternError = 'The active pattern could not be saved.'; }
      finally { this.patternSaving--; }
    },
  },
};
</script>
