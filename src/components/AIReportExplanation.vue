<template lang="pug">
section.mt-4(:aria-labelledby="idPrefix + '-title'")
  h5(:id="idPrefix + '-title'") {{ title }}
  p.small.text-muted This sends only the displayed minimized aggregate after the Privacy Firewall preview. AI output is advisory text and never changes local data or sends an integration.
  p.small.text-muted(v-if="!available" role="status") AI is Off or the signed Custom Endpoint purpose is unavailable. The deterministic report remains local and usable.
  b-form-group(label="Question" :label-for="idPrefix + '-question'")
    b-form-textarea(:id="idPrefix + '-question'" v-model.trim="question" maxlength="4096" rows="3" @input="store.clearPreview()")
  b-form-group(v-if="features.length > 1" label="AI request feature" :label-for="idPrefix + '-feature'")
    b-form-select(:id="idPrefix + '-feature'" v-model="featureId" :options="featureOptions" @change="selectFeature")
  b-button(variant="outline-primary" type="button" @click="preview" :disabled="!available || store.busy || !question.trim()") Preview exact request
  p.text-danger(role="alert" v-if="store.error") {{ store.error }}
  section.mt-3(v-if="currentPreview" :aria-labelledby="idPrefix + '-preview-title'")
    h6(:id="idPrefix + '-preview-title'") Exact request preview
    p Destination: {{ currentPreview.origin }} · Model: {{ currentPreview.model_id }} · Purpose: {{ currentPreview.purpose_id }}
    p Disclosure: {{ currentPreview.retention_disclosure }}
    p Policy version: {{ currentPreview.decision.policy_version }} · Approval scope: once
    p(role="status" aria-live="polite") Decision: {{ currentPreview.decision.outcome }}{{ currentPreview.decision.reason_codes.length ? ` — ${currentPreview.decision.reason_codes.join(', ')}` : '' }}
    ul(v-if="currentPreview.decision.removed_fields.length")
      li(v-for="field in currentPreview.decision.removed_fields" :key="field") Removed field: {{ field }}
    pre(v-if="currentPreview.decision.sanitized_payload" aria-label="Exact sanitized AI request") {{ JSON.stringify(currentPreview.decision.sanitized_payload, null, 2) }}
    b-form-checkbox(v-model="approved" :disabled="store.busy || currentPreview.decision.outcome !== 'allow'" @change="store.approval = null") I approve this exact redacted aggregate for the displayed Custom Endpoint and purpose.
    div.d-flex.flex-wrap.mt-2
      b-button.mr-2(variant="danger" type="button" @click="approveAndSend" :disabled="!approved || store.busy || currentPreview.decision.outcome !== 'allow'") Approve and send exact preview once
      b-button(variant="outline-secondary" type="button" @click="cancel") Cancel preview
  section.mt-3(v-if="currentResult" :aria-labelledby="idPrefix + '-result-title'")
    h6(:id="idPrefix + '-result-title'") AI response
    p Source: {{ currentResult.profile_label }} · {{ currentResult.source_mode }} · {{ currentResult.model_id }}
    p.ai-result-text(role="status") {{ currentResult.text }}
    p.small.text-muted The response is untrusted text. Review it yourself; no action is applied automatically.
    b-button(variant="outline-secondary" size="sm" type="button" @click="saveResult" :disabled="store.busy || savedThisResult") {{ savedThisResult ? 'Saved in encrypted local history' : 'Save this result to encrypted local history' }}
  details.mt-3(v-if="showHistory")
    summary Saved local AI history ({{ store.history.length }} / 50)
    p.small.text-muted Only results you explicitly save appear here. Questions and report aggregates are not saved. Remove a saved result at any time; saving the 51st result removes the first saved result.
    p.small.text-muted(v-if="!store.history.length") No saved AI results.
    article.border.rounded.p-2.mt-2(v-for="insight in store.history" :key="insight.insight_id")
      p.small.mb-1 {{ insight.created_at }} · {{ insight.feature }} · {{ insight.source_mode }} · {{ insight.profile_label }} · {{ insight.model_id }}
      p.ai-result-text {{ insight.text }}
      b-button.mr-2(variant="outline-primary" size="sm" type="button" @click="followUp(insight)") Follow up with this report
      b-button(variant="outline-danger" size="sm" type="button" aria-label="Delete saved insight" @click="store.deleteInsight(insight.insight_id)" :disabled="store.busy") Delete saved insight
</section>
</template>

<script lang="ts">
import { useAIStore } from '~/stores/ai';

type AIRequestFeature = 'question_answer' | 'report_explanation' | 'category_suggestion' | 'freelancer_draft' | 'pattern_comparison';

export default {
  name: 'AIReportExplanation',
  props: {
    aggregate: { type: Object, required: true },
    idPrefix: { type: String, required: true },
    title: { type: String, default: 'Optional AI explanation' },
    defaultQuestion: { type: String, default: 'Explain the daily work totals and highlight visible changes across this report.' },
    features: { type: Array, default: () => ['report_explanation', 'question_answer', 'pattern_comparison'] },
    showHistory: { type: Boolean, default: true },
  },
  data() {
    return {
      store: useAIStore(),
      question: '',
      approved: false,
      priorInsight: null as any,
      featureId: 'report_explanation' as AIRequestFeature,
      savedThisResult: false,
    };
  },
  async created() {
    this.question = this.defaultQuestion;
    this.featureId = this.features[0] as AIRequestFeature;
    await this.store.refresh();
    await this.store.loadHistory();
  },
  watch: {
    aggregate: {
      deep: true,
      handler() {
        this.store.clearPreview();
        this.approved = false;
        this.priorInsight = null;
        this.savedThisResult = false;
      },
    },
  },
  computed: {
    available(): boolean {
      return this.store.settings?.mode === 'custom_endpoint'
        && this.store.status?.custom_endpoint_available === true
        && !!this.store.settings?.active_connection_id;
    },
    profileId(): string {
      return this.store.settings?.active_connection_id || '';
    },
    currentPreview() {
      return this.store.previewFeature === this.featureId ? this.store.preview : null;
    },
    currentResult() {
      return this.store.resultFeature === this.featureId ? this.store.result : null;
    },
    featureOptions(): Array<{ value: string; text: string }> {
      const labels: Record<AIRequestFeature, string> = {
        question_answer: 'Question and answer',
        report_explanation: 'Report explanation',
        category_suggestion: 'Category mapping suggestion',
        freelancer_draft: 'Freelancer draft wording',
        pattern_comparison: 'Pattern comparison',
      };
      return (this.features as AIRequestFeature[]).map(feature => ({ value: feature, text: labels[feature] }));
    },
  },
  methods: {
    async preview() {
      this.approved = false;
      if (this.priorInsight && (this.features as AIRequestFeature[]).includes('question_answer')) {
        this.featureId = 'question_answer';
      }
      const aggregate = this.priorInsight
        ? { ...this.aggregate, prior_insight: {
          profile_label: this.priorInsight.profile_label,
          model_id: this.priorInsight.model_id,
          text: this.priorInsight.text,
        } }
        : this.aggregate;
      await this.store.preview({
        schema_version: 1,
        profile_id: this.profileId,
        feature: this.featureId,
        question: this.question,
        aggregate: aggregate as Record<string, unknown>,
      });
    },
    async approveAndSend() {
      const saved = await this.store.approve(this.profileId, this.featureId);
      if (saved && await this.store.send(this.profileId, this.featureId)) this.savedThisResult = false;
      this.approved = false;
    },
    async saveResult() {
      this.savedThisResult = await this.store.saveResult(this.featureId);
    },
    followUp(insight) {
      this.priorInsight = insight;
      this.question = 'Follow up on this saved explanation using the current report aggregate.';
      this.featureId = (this.features as AIRequestFeature[]).includes('question_answer') ? 'question_answer' : this.features[0] as AIRequestFeature;
      this.store.clearPreview();
      this.approved = false;
    },
    selectFeature() {
      this.priorInsight = null;
      this.store.clearPreview();
      this.approved = false;
    },
    cancel() {
      this.store.clearPreview();
      this.approved = false;
      this.priorInsight = null;
    },
  },
};
</script>

<style scoped>
.ai-result-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
