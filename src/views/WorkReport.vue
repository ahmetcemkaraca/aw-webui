<template lang="pug">
div
  h3.mb-3 Work Time Report

  div.row.mb-4
    div.col-md-3
      b-form-group(label="Hosts" label-class="font-weight-bold")
        b-form-select(v-model="selectedHosts" :options="hostOptions" multiple :select-size="4" :disabled="loading")
        small.text-muted Select devices to include

    div.col-md-3
      b-form-group(label="Categories" label-class="font-weight-bold")
        b-form-select(
          :value="''"
          :options="addableCategoryOptions"
          size="sm"
          :disabled="loading"
          @change="addCategory"
        )
        div.mt-2(v-if="selectedCategories.length > 0")
          span.badge.badge-info.mr-1.mb-1(v-for="(cat, idx) in selectedCategories" :key="idx")
            | {{ JSON.parse(cat).join(' > ') }}
            button.ml-1.close.small(
              type="button"
              aria-label="Remove category"
              style="font-size: 0.85rem; line-height: 1"
              :disabled="loading"
              @click="removeCategory(idx)"
            ) &times;
        small.text-muted.d-block.mt-1 Subcategories are included automatically (e.g. "Work" also covers "Work > Programming").

    div.col-md-3
      b-form-group(label="Break Time" label-class="font-weight-bold")
        div.d-flex.align-items-center
          b-form-input(
            v-model="breakTime"
            type="range"
            min="0"
            max="30"
            step="1"
            :disabled="loading"
          )
          span.ml-2.text-nowrap {{ breakTime }} min
        small.text-muted Gaps shorter than this will be counted as work time

    div.col-md-3
      b-form-group(label="Date Range" label-class="font-weight-bold")
        b-form-select(v-model="dateRange" :options="dateRangeOptions" :disabled="loading")

  div.mb-3
    b-button(v-if="!loading" @click="loadData" variant="primary")
      icon(name="sync")
      |  Calculate Work Time
    b-button(v-else @click="cancelCalculation" variant="outline-danger") Cancel request
    b-button.ml-2(@click="exportCSV" variant="outline-secondary" :disabled="!hasData || loading")
      icon(name="download")
      |  Export CSV
    b-button.ml-2(@click="exportJSON" variant="outline-secondary" :disabled="!hasData || loading")
      icon(name="download")
      |  Export JSON
    label.small.d-inline-block.ml-2
      input.mr-1(type="checkbox" v-model="includeRawEvents" :disabled="loading")
      | Include raw event payloads in JSON export (titles, app names, and event fields)
    p.small.text-muted.mt-2 CSV includes a machine-readable manifest row. JSON omits event payloads unless you opt in above.

  div(v-if="loading")
    b-spinner.mr-2
    | Calculating locally...

  div.alert.alert-info(v-if="!loading && calculationStatus === 'cancelled'" role="status") Calculation request cancelled. The previous report remains available.
  div.alert.alert-warning(v-if="!loading && calculationStatus === 'limited'" role="status") {{ calculationMessage }}
  div.alert.alert-danger(v-if="!loading && calculationError" role="alert") {{ calculationError }}

  div(v-if="hasData && !loading")
    div.alert.alert-info.mt-3(role="note" aria-label="Calculation method and data coverage")
      p.mb-1 Calculation: {{ calculationManifest.method_id }} v{{ calculationManifest.method_version }}. Query duration plus adjacent gaps up to {{ calculationManifest.break_time_seconds }} seconds.
      p.mb-1 {{ calculationManifest.coverage.periods_with_events }} of {{ calculationManifest.coverage.requested_periods }} periods contain events; {{ calculationManifest.coverage.events_seen }} events were evaluated.
      p.mb-0 Coverage limit: {{ calculationManifest.coverage.limitation }}
      p.mb-1(v-if="sourceCoverage") Source health is {{ sourceCoverage.source_health }}. Available sources: {{ sourceCoverage.available_source_buckets.length }}; queried sources: {{ sourceCoverage.queried_source_buckets.length }}.
      p.mb-0(v-if="sourceCoverage")
        | Timezone {{ sourceCoverage.timezone }}, local day starts at {{ calculationManifest.start_of_day }}. {{ sourceCoverage.partial_periods.length }} partial local-day periods: {{ sourceCoverage.partial_periods.join(', ') || 'none' }}. Clock skew: {{ sourceCoverage.clock_skew.status }}; correction bound {{ sourceCoverage.clock_skew.correction_bound_seconds }} seconds.
      p.small.mb-1(v-if="sourceCoverage") Row limits: {{ sourceCoverage.source_row_limit }} per source bucket and {{ sourceCoverage.report_row_limit }} merged intervals per queried period.
      p.small.text-warning.mb-1(v-if="sourceCoverage && sourceCoverage.limited_periods.length") Row cap reached in {{ sourceCoverage.limited_periods.join(', ') }}; those totals are incomplete.
      details.mt-2(v-if="sourceCoverage")
        summary Exact queried periods and sources
        p.small.mt-2 Available: {{ sourceCoverage.available_source_buckets.join(', ') || 'none' }}
        p.small Queried: {{ sourceCoverage.queried_source_buckets.join(', ') || 'none' }}
        ul.small.mb-0
          li(v-for="period in sourceCoverage.queried_periods" :key="period") {{ period }}

    div.alert.alert-secondary.mt-3(v-if="comparisonData" role="status" aria-label="Previous period comparison")
      p.mb-1 {{ comparisonData.method_id }} v{{ comparisonData.method_version }}: {{ comparisonData.current.start_date }}–{{ comparisonData.current.end_date }} compared with {{ comparisonData.previous.start_date }}–{{ comparisonData.previous.end_date }}.
      p.mb-1
        | Work time {{ comparisonData.duration_change >= 0 ? 'increased' : 'decreased' }} by {{ formatDuration(Math.abs(comparisonData.duration_change)) }}
        span(v-if="comparisonData.duration_change_percent !== null") ({{ comparisonData.duration_change_percent.toFixed(1) }}% vs previous period).
        span(v-else) (percentage unavailable because previous work time was zero).
      p.mb-0(v-if="comparisonData.coverage_note" role="note") {{ comparisonData.coverage_note }} Recorded event counts can differ because activity or capture availability changed; source health remains unknown.
    div.alert.alert-light.mt-3(v-else-if="comparisonUnavailable" role="note") Comparison unavailable: an equal-length previous local-calendar window is not available.

    AIReportExplanation(v-if="aiAggregate" id-prefix="work-report-ai" :aggregate="aiAggregate" :features="aiFeatures")

    h5.mt-4 Daily Breakdown

    table.table.table-sm.table-hover
      thead
        tr
          th Date
          th.text-right Work Time
          th.text-right Sessions
          th.text-right Avg Session
      tbody
        tr(v-for="day in dailyData" :key="day.date")
          td {{ day.date }}
          td.text-right {{ formatDuration(day.duration) }}
          td.text-right {{ day.sessions }}
          td.text-right {{ formatDuration(day.avgSession) }}
      tfoot
        tr.font-weight-bold
          td Total
          td.text-right {{ formatDuration(totalDuration) }}
          td.text-right {{ totalSessions }}
          td.text-right {{ formatDuration(avgSessionLength) }}

    section.mt-4(v-if="freelancerAvailable" aria-labelledby="freelancer-timesheet-title")
      h5#freelancer-timesheet-title Create an Approved Timesheet
      p.small.text-muted This uses the current local Work Report result and selected categories. Only project alias, date, approved duration, and your optional note enter the artifact.
      p.small.text-muted Project matches are explainable local category suggestions. Unmatched categories abstain; non-billable and inter-project gaps stay local.
      b-alert(v-if="timesheetError" show variant="danger" role="alert") {{ timesheetError }}
      section.mt-3(v-if="freelancerProjectOptions.length" aria-labelledby="ai-category-suggestion-title")
        h6#ai-category-suggestion-title Optional AI category-to-project suggestion
        b-form-checkbox(v-model="includeProjectLabels") Include local project labels in this exact AI request (otherwise only opaque aliases are sent)
        AIReportExplanation(
          id-prefix="category-ai"
          :aggregate="aiCategoryAggregate"
          title="AI category mapping suggestion"
          default-question="Suggest possible mappings from the selected category labels to these project aliases. Return suggestions only; do not change rules."
          :features="['category_suggestion']"
          :show-history="false"
        )
      b-form-row
        b-col(md="6")
          b-form-group(label="Billable project and date" label-for="timesheet-line")
            b-form-select#timesheet-line(v-model="selectedTimesheetLineKey" :options="timesheetLineOptions" :disabled="!timesheetLineOptions.length || loading")
      b-alert(v-if="projectTimesheetSummary.error" show variant="danger" role="alert") {{ projectTimesheetSummary.error }}
      p(v-if="selectedTimesheetLine" role="note") {{ timesheetMappingExplanation }}
      p(v-if="projectTimesheetSummary.unmapped_duration_seconds" role="note") {{ formatDuration(projectTimesheetSummary.unmapped_duration_seconds) }} remains local because no project rule matched or rounding reduced it to zero.
      p(v-if="projectTimesheetSummary.nonbillable_duration_seconds" role="note") {{ formatDuration(projectTimesheetSummary.nonbillable_duration_seconds) }} is mapped to non-billable projects and stays local.
      section.mt-3(v-if="projectProfitabilityReport.rows.length || projectProfitabilityReport.error" aria-labelledby="project-profitability-title")
        h6#project-profitability-title Local income and estimated project margin
        p.small.text-muted Pre-tax totals for this report period. Costs include mapped billable and non-billable time; these are user-entered estimates, not accounting advice.
        b-alert(v-if="projectProfitabilityReport.error" show variant="danger" role="alert") {{ projectProfitabilityReport.error }}
        table.table.table-sm(v-if="projectProfitabilityReport.rows.length")
          thead
            tr
              th Project alias
              th Billable time
              th Non-billable time
              th Income (minor units)
              th Cost (minor units)
              th Margin (minor units)
          tbody
            tr(v-for="row in projectProfitabilityReport.rows" :key="row.project_alias")
              td #[code {{ row.project_alias }}]
              td {{ formatDuration(row.billable_duration_seconds) }}
              td {{ formatDuration(row.nonbillable_duration_seconds) }}
              td {{ row.income_minor === null ? 'Rate not set' : row.income_minor + ' ' + row.currency_code }}
              td {{ row.cost_minor === null ? 'Cost not set' : row.cost_minor + ' ' + row.currency_code }}
              td {{ row.margin_minor === null ? 'Not calculated' : row.margin_minor + ' ' + row.currency_code }}
        b-button(variant="outline-secondary" type="button" @click="exportProjectProfitabilityCsv") Export local totals CSV
      p(v-if="freelancerProjectOptions.length && !timesheetLineOptions.length" role="status") No billable project-mapped time is available in this report period.
      b-form-group(label="User note (optional)" label-for="timesheet-note")
        b-form-textarea#timesheet-note(v-model="timesheetNote" maxlength="1000" rows="2" :disabled="loading")
      b-form-group(label="Approved duration (seconds)" label-for="timesheet-duration")
        b-form-input#timesheet-duration(v-model.number="timesheetDurationSeconds" type="number" min="1" max="86400" step="1" inputmode="numeric" :disabled="!selectedTimesheetLine || loading")
      p(v-if="!freelancerProjectOptions.length" role="status") No local project is available. Add one in the Freelancer workspace when that capability is enabled.
      b-button(variant="primary" type="button" @click="previewApprovedTimesheet" :disabled="!canPreviewTimesheet || timesheetLoading") {{ timesheetLoading ? 'Preparing exact preview…' : 'Preview Approved Timesheet' }}
      section.mt-3(v-if="timesheetPreview" aria-labelledby="approved-timesheet-preview-title")
        h6#approved-timesheet-preview-title Exact Approved Timesheet preview
        p Project alias: #[code {{ timesheetPreview.timesheet.project_alias }}] · {{ timesheetPreview.timesheet.date }}
        p Source duration: {{ formatDuration(selectedTimesheetLine.source_duration_seconds) }} · Approved duration: {{ formatDuration(timesheetPreview.timesheet.approved_duration_seconds) }} · Rounding: {{ selectedTimesheetLine.rounding_mode }}{{ selectedTimesheetLine.rounding_mode !== 'none' ? ' to ' + selectedTimesheetLine.rounding_increment_seconds + 's' : '' }}
        AIReportExplanation(
          id-prefix="timesheet-ai"
          :aggregate="aiTimesheetAggregate"
          title="Optional AI timesheet wording draft"
          default-question="Draft neutral client-facing wording for this approved timesheet. Do not change its project alias, date or duration."
          :features="['freelancer_draft']"
          :show-history="false"
        )
        p SHA-256: #[code {{ timesheetPreview.artifact_sha256 }}]
        pre(aria-label="Exact Approved Timesheet JSON") {{ timesheetPreview.artifact_json }}
        b-button(variant="success" type="button" @click="exportApprovedTimesheet") Export approved timesheet
        b-button.ml-2(variant="outline-primary" type="button" @click="signApprovedTimesheet" :disabled="timesheetSigning") {{ timesheetSigning ? 'Signing locally…' : 'Create signed client report' }}
        b-alert.mt-2(v-if="timesheetSigningError" show variant="danger" role="alert") {{ timesheetSigningError }}
        section.mt-2(v-if="signedClientReport" aria-labelledby="signed-client-report-title")
          h6#signed-client-report-title Signed client report
          p SHA-256: #[code {{ signedClientReport.artifact_sha256 }}]
          p Device public key: #[code {{ signedClientReport.signer_public_key_ed25519 }}]
          p Signature: #[code {{ signedClientReport.signature_ed25519 }}]
          b-button(variant="outline-secondary" type="button" @click="exportSignedClientReport") Export signed report JSON
          b-button.ml-2(variant="outline-secondary" type="button" @click="printSignedClientReport") Print / save as PDF
          b-alert.mt-2(show variant="warning" role="note") This device signature verifies file integrity against its public key; the key is not identity-certified and this is not a legal signature or tax invoice.
          article#approved-timesheet-print.timesheet-print-only(v-if="signedClientReport")
            h1 PeakActivity Approved Timesheet
            p Project alias: {{ signedClientReport.timesheet.project_alias }}
            p Date: {{ signedClientReport.timesheet.date }}
            p Approved duration: {{ formatDuration(signedClientReport.timesheet.approved_duration_seconds) }}
            p(v-if="signedClientReport.timesheet.user_note") User note: {{ signedClientReport.timesheet.user_note }}
            p SHA-256: {{ signedClientReport.artifact_sha256 }}
            p Device public key: {{ signedClientReport.signer_public_key_ed25519 }}
            p Ed25519 signature: {{ signedClientReport.signature_ed25519 }}
            p Device key is not identity-certified. This report is not a legal signature or tax invoice.
        details.mt-2
          summary CSV preview
          pre(aria-label="Approved Timesheet CSV") {{ approvedTimesheetCsv }}
        b-button.mt-2(variant="outline-secondary" type="button" @click="exportApprovedTimesheetCsv") Export approved timesheet CSV
        b-alert.mt-2(show variant="info" role="note") JSON and CSV exports save local files. Client delivery requires a separate trusted-policy preview and one-time approval.
        section.mt-3(aria-labelledby="timesheet-egress-title")
          h6#timesheet-egress-title Optional client delivery through Privacy Firewall
          p.small.text-muted(v-if="timesheetEgressPolicyLoading" role="status") Checking for a trusted timesheet destination…
          b-button(variant="outline-secondary" size="sm" type="button" @click="loadFreelancerEgressPolicy" :disabled="timesheetEgressPolicyLoading || timesheetEgressBusy") Refresh trusted policy and outbound status
          b-alert(v-if="timesheetEgressPolicyError" show variant="warning" role="status") {{ timesheetEgressPolicyError }}
          template(v-if="timesheetEgressOptions.length")
            b-form-group(label="Signed timesheet destination" label-for="timesheet-egress-purpose")
              b-form-select#timesheet-egress-purpose(v-model="selectedTimesheetEgressPurposeId" :options="timesheetEgressOptions" :disabled="timesheetEgressBusy")
            p.small.text-muted(v-if="!timesheetEgressOutboundEnabled" role="status") Outbound sending is disabled by the local policy or kill switch. Local file export remains available.
            b-button(variant="outline-primary" type="button" @click="previewTimesheetEgress" :disabled="!canPreviewTimesheetEgress || timesheetEgressBusy") Preview recipient, purpose, retention and exact payload
          b-alert(v-if="timesheetEgressError" show variant="danger" role="alert") {{ timesheetEgressError }}
          b-alert(v-if="timesheetEgressNotice" show variant="success" role="status") {{ timesheetEgressNotice }}
          section.mt-2(v-if="timesheetEgressPreview" aria-labelledby="timesheet-egress-preview-title")
            h6#timesheet-egress-preview-title Outbound request preview
            p Recipient: {{ timesheetEgressPreview.destination_id }} — {{ timesheetEgressPreview.destination_origin || 'unregistered' }}
            p Purpose: {{ timesheetEgressPreview.purpose_id }}
            p Retention: {{ timesheetEgressPreview.retention_id }} — {{ timesheetEgressPreview.retention_disclosure || 'No matching retention disclosure' }}
            p(role="status" aria-live="polite") Decision: {{ timesheetEgressPreview.decision.outcome }}{{ timesheetEgressPreview.decision.reason_codes.length ? ' — ' + timesheetEgressPreview.decision.reason_codes.join(', ') : '' }}
            p(v-if="timesheetEgressPayloadExact") SHA-256 matches the approved timesheet: #[code {{ timesheetPreview.artifact_sha256 }}]
            ul(v-if="timesheetEgressPreview.decision.removed_fields.length")
              li(v-for="field in timesheetEgressPreview.decision.removed_fields" :key="field") Removed field: {{ field }}
            pre(v-if="timesheetEgressPreview.decision.sanitized_payload" aria-label="Exact outbound payload") {{ JSON.stringify(timesheetEgressPreview.decision.sanitized_payload, null, 2) }}
            b-alert(v-if="!timesheetEgressPayloadExact" show variant="warning" role="alert") The signed policy changes or removes timesheet fields. This preview cannot be sent as the approved artifact.
            b-form-checkbox(v-model="timesheetEgressApprovalConfirmed" :disabled="!timesheetEgressPayloadExact || !timesheetEgressOutboundEnabled || timesheetEgressBusy") I approve sending this exact timesheet once to the displayed recipient for the displayed purpose and retention.
            b-button.mt-2(variant="danger" type="button" @click="approveAndSendTimesheet" :disabled="!canSendTimesheetEgress || timesheetEgressBusy") {{ timesheetEgressBusy ? 'Sending…' : 'Approve once and send exact timesheet' }}
        div(v-if="invoiceDraft")
          h6 Local invoice draft
          p Draft subtotal: {{ invoiceDraft.subtotal_minor }} {{ invoiceDraft.currency_code }} minor units. Tax is not calculated.
          b-button(variant="outline-secondary" type="button" @click="exportInvoiceDraft") Export draft JSON

    details.mt-4
      summary Weekly and monthly totals
      h6.mt-3 Weekly
      table.table.table-sm.table-hover(v-if="weeklyData.length")
        thead
          tr
            th Week
            th.text-right Days with events
            th.text-right Sessions
            th.text-right Work time
        tbody
          tr(v-for="week in weeklyData" :key="week.period")
            td {{ week.start_date }}–{{ week.end_date }}
            td.text-right {{ week.days_with_events }} / {{ week.days }}
            td.text-right {{ week.sessions }}
            td.text-right {{ formatDuration(week.duration) }}
      h6.mt-3 Monthly
      table.table.table-sm.table-hover(v-if="monthlyData.length")
        thead
          tr
            th Month
            th.text-right Days with events
            th.text-right Sessions
            th.text-right Work time
        tbody
          tr(v-for="month in monthlyData" :key="month.period")
            td {{ month.period }}
            td.text-right {{ month.days_with_events }} / {{ month.days }}
            td.text-right {{ month.sessions }}
            td.text-right {{ formatDuration(month.duration) }}

    h5.mt-4 Activity summaries
    p.small.text-muted Top 5 by duration; only fields present in the minimized local event data are summarized.
    div.row
      div.col-md-4
        h6 Projects
        ul(v-if="fieldSummaries.project.length")
          li(v-for="item in fieldSummaries.project.slice(0, 5)" :key="item.label") {{ item.label }} — {{ formatDuration(item.duration) }}
        p.small.text-muted(v-else) Project field unavailable.
      div.col-md-4
        h6 Applications
        ul(v-if="fieldSummaries.app.length")
          li(v-for="item in fieldSummaries.app.slice(0, 5)" :key="item.label") {{ item.label }} — {{ formatDuration(item.duration) }}
        p.small.text-muted(v-else) Application field unavailable.
      div.col-md-4
        h6 Domains
        ul(v-if="fieldSummaries.domain.length")
          li(v-for="item in fieldSummaries.domain.slice(0, 5)" :key="item.label") {{ item.label }} — {{ formatDuration(item.duration) }}
        p.small.text-muted(v-else) Domain field unavailable.
    p.small.text-muted(v-if="fieldSummaries.active_away")
      | Explicit status fields: active {{ formatDuration(fieldSummaries.active_away.active_duration) }}, away {{ formatDuration(fieldSummaries.active_away.away_duration) }}.
    p.small.text-muted(v-else) Could not determine active/away time because explicit status was missing from part of the event set.

    details.mt-4
      summary Focus, context-switch, and meeting methods
      h6.mt-3 Focus blocks
      p.small.text-muted {{ focusBlocks.method_id }} v{{ focusBlocks.method_version }}; minimum block {{ focusBlocks.thresholds.minimum_duration_seconds }} seconds; short gaps up to {{ focusBlocks.thresholds.maximum_gap_seconds }} seconds stay inside a block.
      p(v-if="focusBlocks.outcome === 'could_not_determine'") Could not determine: {{ focusBlocks.reason }}
      template(v-else)
        p {{ focusBlocks.intervals.length }} qualifying intervals; total {{ formatDuration(focusDuration) }}.
        ul(v-if="focusBlocks.intervals.length")
          li(v-for="interval in focusBlocks.intervals.slice(0, 20)" :key="interval.start") {{ interval.start }}–{{ interval.end }} ({{ formatDuration(interval.duration_seconds) }})
        small.text-muted(v-if="focusBlocks.intervals.length > 20") Showing the first 20 intervals.

      h6.mt-3 Context switches
      p.small.text-muted {{ contextSwitches.method_id }} v{{ contextSwitches.method_version }}; app changes count only when the next event starts within {{ contextSwitches.thresholds.maximum_gap_seconds }} seconds.
      p(v-if="contextSwitches.outcome === 'could_not_determine'") Could not determine: {{ contextSwitches.reason }}
      template(v-else)
        p {{ contextSwitches.intervals.length }} observed context switches.
        ul(v-if="contextSwitches.intervals.length")
          li(v-for="(interval, index) in contextSwitches.intervals.slice(0, 20)" :key="index") {{ interval.from_app }} → {{ interval.to_app }} at {{ interval.end }} ({{ interval.gap_seconds }} seconds)
        small.text-muted(v-if="contextSwitches.intervals.length > 20") Showing the first 20 transitions.

      h6.mt-3 Meeting load
      p.small.text-muted {{ meetingLoad.method_id }} v{{ meetingLoad.method_version }}; counts selected Meeting categories with intervals of at least {{ meetingLoad.thresholds.minimum_interval_seconds }} seconds. App names are not used to infer meetings.
      p(v-if="meetingLoad.outcome === 'could_not_determine'") Could not determine: {{ meetingLoad.reason }}
      template(v-else)
        p {{ meetingLoad.intervals.length }} qualifying intervals; total {{ formatDuration(meetingLoad.duration_seconds) }}.
        ul(v-if="meetingLoad.intervals.length")
          li(v-for="interval in meetingLoad.intervals.slice(0, 20)" :key="interval.start") {{ interval.start }}–{{ interval.end }} ({{ formatDuration(interval.duration_seconds) }})
        small.text-muted(v-if="meetingLoad.intervals.length > 20") Showing the first 20 intervals.

</template>

<script lang="ts">
import { getClient } from '~/util/awclient';
import AIReportExplanation from '~/components/AIReportExplanation.vue';
import { useCategoryStore } from '~/stores/categories';
import { useSettingsStore } from '~/stores/settings';
import { useBucketsStore } from '~/stores/buckets';
import {
  getSupportedWorkReportHosts,
  getWorkReportHostOptions,
  getUnsupportedWorkReportHosts,
  buildWorkReportQuery,
  buildWorkReportWindows,
  buildWorkReportSourceCoverage,
  getLimitedWorkReportPeriods,
  isWorkReportCancelled,
  queryWorkReport,
  aggregateDailyWorkReport,
  calculateDailyWorkReport,
  buildWorkReportCsv,
  buildWorkReportJsonExport,
  compareWorkReportPeriods,
  summarizeWorkReportFields,
  calculateFocusBlocks,
  calculateContextSwitches,
  calculateMeetingLoad,
  WORK_REPORT_FIELD_SUMMARY_METHOD_ID,
  WORK_REPORT_FIELD_SUMMARY_METHOD_VERSION,
  WORK_REPORT_MAX_QUERY_PERIODS,
} from '~/util/workReport';
import type {
  DailyWorkReportV1,
  WorkReportAggregateV1,
  WorkReportComparisonV1,
  WorkReportFieldSummaryV1,
  WorkReportFocusBlocksV1,
  WorkReportContextSwitchesV1,
  WorkReportMeetingLoadV1,
  WorkReportSourceCoverageV1,
} from '~/util/workReport';

import 'vue-awesome/icons/sync';
import 'vue-awesome/icons/download';
import experience from '~/generated/product-experience.json';
import { capability, isShipped } from '~/product/experience';
import { hasFeatureEntitlement, loadNativeEntitlementStatus } from '~/util/entitlement';
import {
  buildApprovedTimesheet,
  buildInvoiceDraft,
  buildProjectTimesheetLines,
  FREELANCER_TIMESHEET_EGRESS_PURPOSE_V1,
  isExactApprovedTimesheetPayload,
  serializeProjectProfitabilityCsv,
  serializeApprovedTimesheet,
  serializeApprovedTimesheetCsv,
  summarizeProjectProfitability,
} from '~/util/freelancer';
import type {
  ApprovedTimesheetV1,
  FreelancerWorkspaceV1,
  InvoiceDraftV1,
  ProjectProfitabilityV1,
  ProjectTimesheetLineV1,
  SignedClientReportV1,
} from '~/util/freelancer';

interface TimesheetEgressDestinationV1 {
  id: string;
  status: string;
  https_origin: string | null;
  allowed_purposes: string[];
}

interface TimesheetEgressPurposeV1 {
  id: string;
  destination_id: string;
  retention_id: string;
  retention_disclosure: string;
  allowed_fields: string[];
}

interface TimesheetEgressPreviewV1 {
  destination_id: string;
  destination_origin: string | null;
  purpose_id: string;
  retention_id: string;
  retention_disclosure: string | null;
  decision: {
    outcome: 'allow' | 'deny';
    sanitized_payload: unknown;
    removed_fields: string[];
    reason_codes: string[];
    preview_id: string;
  };
}

export default {
  name: 'WorkReport',
  components: { AIReportExplanation },
  data() {
    return {
      categoryStore: useCategoryStore(),
      settingsStore: useSettingsStore(),
      bucketsStore: useBucketsStore(),

      selectedHosts: [] as string[],
      selectedCategories: [JSON.stringify(['Work'])],
      includeProjectLabels: false,
      breakTime: 5,
      dateRange: 'last7d',

      loading: false,
      dailyData: [] as DailyWorkReportV1[],
      rawData: [] as any[],
      includeRawEvents: false,
      calculationManifest: null,
      comparisonData: null as WorkReportComparisonV1 | null,
      comparisonUnavailable: false,
      weeklyData: [] as WorkReportAggregateV1[],
      monthlyData: [] as WorkReportAggregateV1[],
      fieldSummaries: {
        method_id: WORK_REPORT_FIELD_SUMMARY_METHOD_ID,
        method_version: WORK_REPORT_FIELD_SUMMARY_METHOD_VERSION,
        project: [],
        app: [],
        domain: [],
        active_away: null,
      } as WorkReportFieldSummaryV1,
      focusBlocks: null as WorkReportFocusBlocksV1 | null,
      contextSwitches: null as WorkReportContextSwitchesV1 | null,
      meetingLoad: null as WorkReportMeetingLoadV1 | null,
      sourceCoverage: null as WorkReportSourceCoverageV1 | null,
      queryController: null as AbortController | null,
      calculationStatus: '',
      calculationMessage: '',
      calculationError: '',
      freelancerWorkspace: null as FreelancerWorkspaceV1 | null,
      freelancerEntitlementAvailable: false,
      selectedTimesheetLineKey: '',
      timesheetDurationSeconds: 0,
      timesheetNote: '',
      timesheetPreview: null as { timesheet: ApprovedTimesheetV1; artifact_json: string; artifact_sha256: string } | null,
      signedClientReport: null as SignedClientReportV1 | null,
      timesheetSigning: false,
      timesheetSigningError: '',
      invoiceDraft: null as InvoiceDraftV1 | null,
      timesheetLoading: false,
      timesheetError: '',
      timesheetEgressPolicy: null as { destinations: TimesheetEgressDestinationV1[]; purposes: TimesheetEgressPurposeV1[] } | null,
      timesheetEgressPolicyLoading: false,
      timesheetEgressPolicyError: '',
      timesheetEgressOutboundEnabled: false,
      selectedTimesheetEgressPurposeId: '',
      timesheetEgressPreview: null as TimesheetEgressPreviewV1 | null,
      timesheetEgressApprovalConfirmed: false,
      timesheetEgressBusy: false,
      timesheetEgressError: '',
      timesheetEgressNotice: '',
    };
  },
  computed: {
    hostOptions() {
      return getWorkReportHostOptions(this.bucketsStore.buckets || []);
    },

    categoryOptions() {
      const cats = this.categoryStore.all_categories || [];
      return cats.map(cat => ({
        value: JSON.stringify(cat),
        text: cat.join(' > '),
      }));
    },
    // Hide categories that are already selected (or that are descendants of
    // a selected category, since we auto-include subcategories anyway).
    addableCategoryOptions() {
      const selected: string[][] = this.selectedCategories.map(c => JSON.parse(c));
      const isCoveredBySelected = (cat: string[]) =>
        selected.some(sel => sel.every((seg, i) => cat[i] === seg));
      return [
        {
          value: '',
          text: this.selectedCategories.length === 0 ? 'Select category…' : 'Add category…',
          disabled: true,
        },
        ...this.categoryOptions.filter(opt => !isCoveredBySelected(JSON.parse(opt.value))),
      ];
    },
    dateRangeOptions() {
      return [
        { value: 'last7d', text: 'Last 7 days' },
        { value: 'last30d', text: 'Last 30 days' },
        { value: 'thisWeek', text: 'This week' },
        { value: 'thisMonth', text: 'This month' },
      ];
    },
    hasData() {
      return this.dailyData.length > 0;
    },
    totalDuration() {
      return this.dailyData.reduce((sum, day) => sum + day.duration, 0);
    },
    totalSessions() {
      return this.dailyData.reduce((sum, day) => sum + day.sessions, 0);
    },
    aiAggregate(): Record<string, unknown> | null {
      if (!this.hasData || !this.calculationManifest) return null;
      return {
        method_id: this.calculationManifest.method_id,
        method_version: this.calculationManifest.method_version,
        break_time_seconds: this.calculationManifest.break_time_seconds,
        date_range: {
          start_date: this.dailyData[0].date,
          end_date: this.dailyData[this.dailyData.length - 1].date,
        },
        daily: this.dailyData.slice(0, 62).map(day => ({
          date: day.date,
          duration_seconds: day.duration,
          session_count: day.sessions,
          average_session_seconds: day.avgSession,
        })),
        coverage: {
          requested_periods: this.calculationManifest.coverage.requested_periods,
          periods_with_data: this.calculationManifest.coverage.periods_with_events,
          limitation: this.calculationManifest.coverage.limitation,
        },
        weekly: this.weeklyData.map(week => ({
          start_date: week.start_date,
          end_date: week.end_date,
          days_with_data: week.days_with_events,
          duration_seconds: week.duration,
        })),
        monthly: this.monthlyData.map(month => ({
          period: month.period,
          days_with_data: month.days_with_events,
          duration_seconds: month.duration,
        })),
        comparison: this.comparisonData ? {
          current: { start_date: this.comparisonData.current.start_date, end_date: this.comparisonData.current.end_date },
          previous: { start_date: this.comparisonData.previous.start_date, end_date: this.comparisonData.previous.end_date },
          duration_change_seconds: this.comparisonData.duration_change,
          duration_change_percent: this.comparisonData.duration_change_percent,
          coverage_note: this.comparisonData.coverage_note,
        } : null,
      };
    },
    aiFeatures(): string[] {
      return ['report_explanation', 'question_answer', ...(this.comparisonData ? ['pattern_comparison'] : [])];
    },
    aiCategoryAggregate(): Record<string, unknown> {
      const categories = this.selectedCategories.map((value: string) => (JSON.parse(value) as string[]).join(' > '));
      const projects = (this.freelancerWorkspace?.projects || []).map(project => this.includeProjectLabels
        ? { project_alias: project.project_alias, display_label: project.label }
        : { project_alias: project.project_alias });
      const existing_mappings = (this.freelancerWorkspace?.category_rules || []).map(rule => ({
        category: rule.category_path.join(' > '),
        project_alias: rule.project_alias,
      }));
      return { categories, projects, existing_mappings };
    },
    aiTimesheetAggregate(): Record<string, unknown> {
      if (!this.timesheetPreview) return {};
      return {
        project_alias: this.timesheetPreview.timesheet.project_alias,
        date: this.timesheetPreview.timesheet.date,
        approved_duration_seconds: this.timesheetPreview.timesheet.approved_duration_seconds,
      };
    },
    freelancerProjectOptions(): { value: string; text: string }[] {
      return (this.freelancerWorkspace?.projects || []).map(project => ({
        value: project.project_alias,
        text: `${project.label} (${project.project_alias})`,
      }));
    },
    avgSessionLength() {
      return this.totalSessions > 0 ? this.totalDuration / this.totalSessions : 0;
    },
    focusDuration() {
      return (
        this.focusBlocks?.intervals.reduce((sum, interval) => sum + interval.duration_seconds, 0) ||
        0
      );
    },
    freelancerAvailable(): boolean { return this.freelancerEntitlementAvailable; },
    projectTimesheetSummary(): { lines: ProjectTimesheetLineV1[]; unmapped_duration_seconds: number; nonbillable_duration_seconds: number; error: string } {
      if (!this.freelancerWorkspace) return { lines: [], unmapped_duration_seconds: 0, nonbillable_duration_seconds: 0, error: '' };
      try {
        return { ...buildProjectTimesheetLines(this.dailyData, this.freelancerWorkspace, this.breakTime * 60), error: '' };
      } catch (error) {
        return {
          lines: [], unmapped_duration_seconds: 0, nonbillable_duration_seconds: 0,
          error: error instanceof Error ? error.message : 'Timesheet calculation failed.',
        };
      }
    },
    projectProfitabilityReport(): { rows: ProjectProfitabilityV1[]; error: string } {
      if (!this.freelancerWorkspace) return { rows: [], error: '' };
      try {
        return {
          rows: summarizeProjectProfitability(this.projectTimesheetSummary.lines, this.freelancerWorkspace),
          error: '',
        };
      } catch (_) {
        return { rows: [], error: 'Local project estimates exceed the supported amount range.' };
      }
    },
    timesheetLineOptions(): { value: string; text: string }[] {
      return this.projectTimesheetSummary.lines.filter(line => line.billable && line.approved_duration_seconds > 0)
        .map(line => {
          const project = this.freelancerWorkspace?.projects.find(item => item.project_alias === line.project_alias);
          return {
            value: `${line.project_alias}\u0000${line.date}`,
            text: `${project?.label || 'Local project'} (${line.project_alias}) · ${line.date} · ${this.formatDuration(line.approved_duration_seconds)}`,
          };
        });
    },
    selectedTimesheetLine(): ProjectTimesheetLineV1 | null {
      return this.projectTimesheetSummary.lines.find(line => `${line.project_alias}\u0000${line.date}` === this.selectedTimesheetLineKey) || null;
    },
    timesheetMappingExplanation(): string {
      const line = this.selectedTimesheetLine;
      if (!line) return '';
      const confidence = line.mapping_confidence === 'exact'
        ? 'Exact category rule'
        : line.mapping_confidence === 'inherited'
        ? 'Parent category rule'
        : 'Mixed exact and parent category rules';
      const rules = line.mapping_rule_paths.map(path => path.join(' > ')).join('; ');
      return `${confidence}: ${rules}. Review this local suggestion before approving the timesheet.`;
    },
    selectedTimesheetProject() {
      return this.freelancerWorkspace?.projects.find(project => project.project_alias === this.selectedTimesheetLine?.project_alias) || null;
    },
    timesheetEgressOptions(): { value: string; text: string; purpose: TimesheetEgressPurposeV1; destination: TimesheetEgressDestinationV1 }[] {
      const destinations = this.timesheetEgressPolicy?.destinations || [];
      return (this.timesheetEgressPolicy?.purposes || [])
        .filter(purpose => purpose.id === FREELANCER_TIMESHEET_EGRESS_PURPOSE_V1)
        .map(purpose => ({
          purpose,
          destination: destinations.find(item => item.id === purpose.destination_id) as TimesheetEgressDestinationV1,
        }))
        .filter(item => !!item.destination
          && ['available', 'beta', 'experimental'].includes(item.destination.status)
          && item.destination.allowed_purposes.includes(item.purpose.id))
        .map(item => ({
          ...item,
          value: item.purpose.id,
          text: `${item.destination.id} — ${item.destination.https_origin} — ${item.purpose.retention_id}`,
        }));
    },
    selectedTimesheetEgressPurpose(): TimesheetEgressPurposeV1 | null {
      return this.timesheetEgressOptions.find(item => item.purpose.id === this.selectedTimesheetEgressPurposeId)?.purpose || null;
    },
    selectedTimesheetEgressDestination(): TimesheetEgressDestinationV1 | null {
      return this.timesheetEgressOptions.find(item => item.purpose.id === this.selectedTimesheetEgressPurposeId)?.destination || null;
    },
    timesheetEgressPayloadExact(): boolean {
      return !!this.timesheetPreview && !!this.timesheetEgressPreview
        && this.timesheetEgressPreview.decision.outcome === 'allow'
        && isExactApprovedTimesheetPayload(
          this.timesheetPreview.timesheet,
          this.timesheetEgressPreview.decision.sanitized_payload,
        );
    },
    canPreviewTimesheetEgress(): boolean {
      return !!this.timesheetPreview && !!this.selectedTimesheetEgressPurpose
        && !!this.selectedTimesheetEgressDestination;
    },
    canSendTimesheetEgress(): boolean {
      return this.timesheetEgressApprovalConfirmed && this.timesheetEgressOutboundEnabled
        && this.timesheetEgressPayloadExact;
    },
    approvedTimesheetCsv(): string {
      if (!this.timesheetPreview) return '';
      return serializeApprovedTimesheetCsv(this.timesheetPreview.timesheet);
    },
    canPreviewTimesheet(): boolean {
      const duration = Number(this.timesheetDurationSeconds);
      return this.freelancerAvailable && !this.loading && !!this.selectedTimesheetProject
        && !!this.selectedTimesheetLine && Number.isSafeInteger(duration)
        && duration > 0 && duration <= 86_400;
    },
  },
  async mounted() {
    this.categoryStore.load();
    await this.bucketsStore.ensureLoaded();

    if (this.hostOptions.length > 0) {
      this.selectedHosts = this.hostOptions.filter(opt => !opt.disabled).map(opt => opt.value);
    }
    if (isShipped('freelancer-workspace', experience)) {
      const entitlement = await loadNativeEntitlementStatus();
      const freelancerCapability = capability('freelancer-workspace', experience);
      this.freelancerEntitlementAvailable = hasFeatureEntitlement(
        freelancerCapability?.status, entitlement, 'freelancer-workspace',
      );
      if (this.freelancerAvailable) await this.loadFreelancerWorkspace();
      if (this.freelancerAvailable) await this.loadFreelancerEgressPolicy();
    }
  },
  watch: {
    selectedCategories: { handler() { this.clearTimesheetPreview(); }, deep: true },
    selectedHosts: { handler() { this.clearTimesheetPreview(); }, deep: true },
    dateRange() { this.clearTimesheetPreview(); },
    breakTime() { this.clearTimesheetPreview(); },
    selectedTimesheetLineKey() {
      this.timesheetDurationSeconds = this.selectedTimesheetLine?.approved_duration_seconds || 0;
      this.clearTimesheetPreview();
    },
    selectedTimesheetEgressPurposeId() { this.clearTimesheetEgressPreview(); },
    timesheetDurationSeconds() { this.clearTimesheetPreview(); },
    timesheetNote() { this.clearTimesheetPreview(); },
  },
  methods: {
    cancelCalculation() {
      this.queryController?.abort();
    },
    async loadData() {
      if (this.loading) return;
      this.clearTimesheetPreview();
      this.loading = true;
      this.calculationStatus = '';
      this.calculationMessage = '';
      this.calculationError = '';
      const controller = new AbortController();
      this.queryController = controller;
      try {
        const client = getClient();
        const reportDateRange = this.dateRange;
        const startOfDay = this.settingsStore.startOfDay;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
        const selectedCategories = [...this.selectedCategories];
        let selectedHosts = [...this.selectedHosts];
        const reportBreakTime = this.breakTime;

        if (selectedHosts.length === 0) {
          alert('Please select at least one host');
          return;
        }

        if (selectedCategories.length === 0) {
          alert('Please select at least one category');
          return;
        }

        const unsupportedHosts = getUnsupportedWorkReportHosts(
          selectedHosts,
          this.bucketsStore.buckets || []
        );
        if (unsupportedHosts.length > 0) {
          const supportedHosts = getSupportedWorkReportHosts(
            selectedHosts,
            this.bucketsStore.buckets || []
          );
          if (supportedHosts.length === 0) {
            alert(
              `The selected hosts are missing aw-watcher-afk buckets and can't be included in Work Report: ${unsupportedHosts.join(
                ', '
              )}`
            );
            return;
          }

          alert(
            `Skipping hosts without aw-watcher-afk buckets: ${unsupportedHosts.join(
              ', '
            )}. Work Report will use: ${supportedHosts.join(', ')}`
          );
          selectedHosts = supportedHosts;
          this.selectedHosts = supportedHosts;
        }

        const hostsToQuery = getSupportedWorkReportHosts(
          selectedHosts,
          this.bucketsStore.buckets || []
        );
        const windows = buildWorkReportWindows(reportDateRange, startOfDay);
        const timeperiods = [...windows.current, ...(windows.previous || [])];
        if (timeperiods.length > WORK_REPORT_MAX_QUERY_PERIODS) {
          this.calculationStatus = 'limited';
          this.calculationMessage = `This report requests ${timeperiods.length} periods; the limit is ${WORK_REPORT_MAX_QUERY_PERIODS}. Choose a shorter date range.`;
          return;
        }
        const availableSourceBuckets = (this.bucketsStore.buckets || [])
          .filter(bucket => bucket.type === 'currentwindow' || bucket.type === 'afkstatus')
          .map(bucket => bucket.id);
        const queriedSourceBuckets = hostsToQuery.flatMap(host => [
          `aw-watcher-window_${host}`,
          `aw-watcher-afk_${host}`,
        ]);
        const breakTimeSeconds = reportBreakTime * 60;
        // Auto-expand the selection to include subcategories. Selecting
        // "Work" should also match "Work > Programming", "Work > Email",
        // etc., which is what users intuitively expect — aw-query's
        // filter_keyvals only does exact-array matches on $category.
        const allCategories = (this.categoryStore.all_categories || []) as string[][];
        const selected: string[][] = selectedCategories.map(c => JSON.parse(c));
        const isDescendant = (sel: string[], cat: string[]) =>
          cat.length >= sel.length && sel.every((seg, i) => cat[i] === seg);
        const expanded: string[][] = [];
        const seen = new Set<string>();
        for (const cat of allCategories) {
          if (selected.some(sel => isDescendant(sel, cat))) {
            const key = JSON.stringify(cat);
            if (!seen.has(key)) {
              seen.add(key);
              expanded.push(cat);
            }
          }
        }
        // Also keep the originally-selected categories even if they aren't
        // in all_categories (defensive).
        for (const sel of selected) {
          const key = JSON.stringify(sel);
          if (!seen.has(key)) {
            seen.add(key);
            expanded.push(sel);
          }
        }
        const categoriesFilter = expanded;

        const categories = this.categoryStore.classes_for_query;
        const categoriesStr = JSON.stringify(categories).replace(/\\\\/g, '\\');

        const query = buildWorkReportQuery(hostsToQuery, categoriesStr, categoriesFilter);

        const results = await queryWorkReport(client, query, timeperiods, controller.signal);
        if (controller.signal.aborted) {
          this.calculationStatus = 'cancelled';
          return;
        }
        const limitedPeriods = getLimitedWorkReportPeriods(results, timeperiods);
        const currentResults = results.slice(0, windows.current.length);
        const previousResults = windows.previous ? results.slice(windows.current.length) : [];

        const calculation = calculateDailyWorkReport(
          windows.current,
          currentResults,
          breakTimeSeconds,
          {
            hostIds: hostsToQuery,
            categoryPaths: categoriesFilter,
            dateRange: reportDateRange,
            startOfDay,
          }
        );
        this.comparisonData = null;
        this.comparisonUnavailable = false;
        this.dailyData = calculation.daily;
        this.calculationManifest = calculation.manifest;
        this.weeklyData = aggregateDailyWorkReport(this.dailyData, 'week');
        this.monthlyData = aggregateDailyWorkReport(this.dailyData, 'month');
        this.fieldSummaries = summarizeWorkReportFields(this.dailyData);
        this.focusBlocks = calculateFocusBlocks(this.dailyData);
        this.contextSwitches = calculateContextSwitches(this.dailyData);
        this.meetingLoad = calculateMeetingLoad(this.dailyData, categoriesFilter);
        this.sourceCoverage = buildWorkReportSourceCoverage({
          availableSourceBuckets,
          queriedSourceBuckets,
          queriedPeriods: timeperiods,
          partialPeriods: windows.partial_periods,
          limitedPeriods,
          timezone,
          deviceCount: hostsToQuery.length,
        });
        if (windows.previous) {
          const previous = calculateDailyWorkReport(
            windows.previous,
            previousResults,
            breakTimeSeconds,
            {
              hostIds: hostsToQuery,
              categoryPaths: categoriesFilter,
              dateRange: reportDateRange,
              startOfDay,
            }
          );
          this.comparisonData = compareWorkReportPeriods(this.dailyData, previous.daily);
        }
        this.comparisonUnavailable = !this.comparisonData;

        this.rawData = currentResults;
        this.calculationStatus = limitedPeriods.length > 0 ? 'limited' : 'complete';
        if (limitedPeriods.length) {
          this.calculationMessage = `Some query periods reached an event-row cap (${limitedPeriods.join(
            ', '
          )}); these totals may be incomplete. Choose a shorter range for a complete report.`;
        }
      } catch (error) {
        if (controller.signal.aborted || isWorkReportCancelled(error)) {
          this.calculationStatus = 'cancelled';
          return;
        }
        this.calculationStatus = 'failed';
        this.calculationError =
          'The report could not be calculated. The previous report data is still available.';
      } finally {
        if (this.queryController === controller) this.queryController = null;
        this.loading = false;
      }
    },

    addCategory(value: string) {
      if (!value) return;
      if (!this.selectedCategories.includes(value)) {
        this.selectedCategories = [...this.selectedCategories, value];
      }
    },

    removeCategory(idx: number) {
      this.selectedCategories = this.selectedCategories.filter((_c, i) => i !== idx);
    },

    formatDuration(seconds: number): string {
      if (!seconds) return '0:00';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}:${minutes.toString().padStart(2, '0')}`;
    },

    exportCSV() {
      const csv = buildWorkReportCsv(
        this.dailyData,
        {
          totalDuration: this.totalDuration,
          totalSessions: this.totalSessions,
          avgSessionLength: this.avgSessionLength,
        },
        {
          schema_version: 1,
          calculation_manifest: this.calculationManifest,
          source_coverage: this.sourceCoverage,
          comparison: this.comparisonData,
          weekly: this.weeklyData,
          monthly: this.monthlyData,
          field_summaries: this.fieldSummaries,
          metrics: {
            focus_blocks: this.focusBlocks,
            context_switches: this.contextSwitches,
            meeting_load: this.meetingLoad,
          },
        }
      );

      this.downloadFile(csv, 'work_time_report.csv', 'text/csv');
    },

    exportJSON() {
      const data = buildWorkReportJsonExport(
        {
          parameters: {
            host_ids: this.calculationManifest.host_ids,
            category_paths: this.calculationManifest.category_paths,
            break_time_seconds: this.calculationManifest.break_time_seconds,
            date_range: this.calculationManifest.date_range,
            start_of_day: this.calculationManifest.start_of_day,
          },
          calculation_manifest: this.calculationManifest,
          source_coverage: this.sourceCoverage,
          comparison: this.comparisonData,
          weekly: this.weeklyData,
          monthly: this.monthlyData,
          field_summaries: this.fieldSummaries,
          metrics: {
            focus_blocks: this.focusBlocks,
            context_switches: this.contextSwitches,
            meeting_load: this.meetingLoad,
          },
          summary: {
            totalDuration: this.totalDuration,
            totalSessions: this.totalSessions,
            avgSessionLength: this.avgSessionLength,
          },
          daily: this.dailyData,
        },
        this.rawData,
        this.includeRawEvents
      );

      const json = JSON.stringify(data, null, 2);
      this.downloadFile(json, 'work_time_report.json', 'application/json');
    },

    clearTimesheetPreview() {
      this.timesheetPreview = null;
      this.signedClientReport = null;
      this.invoiceDraft = null;
      this.timesheetError = '';
      this.timesheetSigningError = '';
      this.clearTimesheetEgressPreview();
      this.timesheetEgressNotice = '';
    },

    clearTimesheetEgressPreview() {
      this.timesheetEgressPreview = null;
      this.timesheetEgressApprovalConfirmed = false;
      this.timesheetEgressError = '';
    },

    async loadFreelancerWorkspace() {
      if (!this.freelancerAvailable) return;
      try {
        const response = await getClient().req.get('/0/freelancer/workspace');
        this.freelancerWorkspace = response.data as FreelancerWorkspaceV1;
        const firstLine = this.projectTimesheetSummary.lines.find(line => line.billable && line.approved_duration_seconds > 0);
        this.selectedTimesheetLineKey = firstLine ? `${firstLine.project_alias}\u0000${firstLine.date}` : '';
      } catch (_) {
        this.timesheetError = 'Local project settings are unavailable. Unlock the vault and retry.';
      }
    },

    async loadFreelancerEgressPolicy() {
      if (!this.freelancerAvailable) return;
      this.clearTimesheetEgressPreview();
      this.timesheetEgressPolicyLoading = true;
      this.timesheetEgressPolicyError = '';
      try {
        const client = getClient().req;
        const [statusResponse, policyResponse] = await Promise.all([
          client.get('/api/0/egress/status'),
          client.get('/api/0/egress/policy'),
        ]);
        this.timesheetEgressOutboundEnabled = statusResponse.data.outbound_enabled === true;
        this.timesheetEgressPolicy = policyResponse.data;
        this.selectedTimesheetEgressPurposeId = this.timesheetEgressOptions[0]?.purpose.id || '';
        if (!this.timesheetEgressOptions.length) {
          this.timesheetEgressPolicyError = 'No signed Freelancer timesheet destination is configured. The artifact stays local.';
        }
      } catch (_) {
        this.timesheetEgressPolicy = null;
        this.timesheetEgressOutboundEnabled = false;
        this.selectedTimesheetEgressPurposeId = '';
        this.timesheetEgressPolicyError = 'No trusted outbound policy is available. The artifact stays local.';
      } finally {
        this.timesheetEgressPolicyLoading = false;
      }
    },

    async previewApprovedTimesheet() {
      const selectedProject = this.selectedTimesheetProject;
      const selectedLine = this.selectedTimesheetLine;
      if (!this.canPreviewTimesheet || !selectedProject || !selectedLine) return;
      this.timesheetLoading = true;
      this.timesheetError = '';
      this.clearTimesheetPreview();
      try {
        const project = selectedProject;
        const timesheet = buildApprovedTimesheet({
          project_alias: project.project_alias,
          date: selectedLine.date,
          approved_duration_seconds: Number(this.timesheetDurationSeconds),
          user_note: this.timesheetNote,
        });
        const response = await getClient().req.post('/0/freelancer/timesheet/preview', timesheet);
        const preview = response.data as { timesheet: ApprovedTimesheetV1; artifact_json: string; artifact_sha256: string };
        const expectedJson = serializeApprovedTimesheet(timesheet);
        const serializedTimesheet = serializeApprovedTimesheet(preview.timesheet);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preview.artifact_json));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== preview.artifact_sha256 || hash.length !== 64
            || serializedTimesheet !== expectedJson || preview.artifact_json !== expectedJson) {
          throw new Error('The approved preview changed. Recalculate and review it again.');
        }
        this.timesheetPreview = preview;
        this.invoiceDraft = project.hourly_rate_minor === null || project.currency_code === null
          ? null
          : buildInvoiceDraft({
              project_alias: project.project_alias,
              period_start: timesheet.date,
              period_end: timesheet.date,
              currency_code: project.currency_code,
              approved_duration_seconds: timesheet.approved_duration_seconds,
              hourly_rate_minor: project.hourly_rate_minor,
            });
      } catch (_) {
        this.timesheetError = 'The Approved Timesheet could not be prepared. No client or integration request was sent.';
      } finally {
        this.timesheetLoading = false;
      }
    },

    async signApprovedTimesheet() {
      const preview = this.timesheetPreview;
      if (!preview || this.timesheetSigning) return;
      this.signedClientReport = null;
      this.timesheetSigningError = '';
      this.timesheetSigning = true;
      try {
        const response = await getClient().req.post('/0/freelancer/timesheet/sign', preview.timesheet);
        const report = response.data as SignedClientReportV1;
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest(
          'SHA-256', new TextEncoder().encode(serializeApprovedTimesheet(report.timesheet)),
        )), byte => byte.toString(16).padStart(2, '0')).join('');
        if (this.timesheetPreview?.artifact_sha256 !== preview.artifact_sha256
            || !isExactApprovedTimesheetPayload(preview.timesheet, report.timesheet)
            || report.artifact_sha256 !== preview.artifact_sha256 || hash !== report.artifact_sha256
            || !/^[0-9a-f]{64}$/.test(report.signer_public_key_ed25519)
            || !/^[0-9a-f]{128}$/.test(report.signature_ed25519)) {
          throw new Error('The signed report does not match the approved preview.');
        }
        this.signedClientReport = report;
      } catch (_) {
        this.timesheetSigningError = 'The signed report could not be verified or saved in the local vault.';
      } finally {
        this.timesheetSigning = false;
      }
    },

    exportSignedClientReport() {
      if (!this.signedClientReport) return;
      this.downloadFile(
        JSON.stringify(this.signedClientReport),
        `signed-timesheet-${this.signedClientReport.timesheet.project_alias}-${this.signedClientReport.timesheet.date}.json`,
        'application/json',
      );
    },

    printSignedClientReport() {
      if (!this.signedClientReport) return;
      let fallback: number | undefined;
      const cleanup = () => {
        if (fallback !== undefined) window.clearTimeout(fallback);
        document.body.classList.remove('timesheet-print-mode');
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      document.body.classList.add('timesheet-print-mode');
      fallback = window.setTimeout(cleanup, 60_000);
      try {
        window.print();
      } catch (_) {
        cleanup();
        this.timesheetSigningError = 'The system print dialog is unavailable on this device.';
      }
    },

    async previewTimesheetEgress() {
      const purpose = this.selectedTimesheetEgressPurpose;
      const destination = this.selectedTimesheetEgressDestination;
      if (!this.canPreviewTimesheetEgress || !purpose || !destination || !this.timesheetPreview) return;
      this.clearTimesheetEgressPreview();
      this.timesheetEgressNotice = '';
      this.timesheetEgressBusy = true;
      try {
        const response = await getClient().req.post('/api/0/egress/preview', {
          schema_version: 1,
          destination_id: destination.id,
          purpose_id: purpose.id,
          retention_id: purpose.retention_id,
          payload: this.timesheetPreview.timesheet,
        });
        this.timesheetEgressPreview = response.data as TimesheetEgressPreviewV1;
      } catch (_) {
        this.timesheetEgressError = 'The exact recipient and retention preview is unavailable. No request was sent.';
      } finally {
        this.timesheetEgressBusy = false;
      }
    },

    async approveAndSendTimesheet() {
      const preview = this.timesheetEgressPreview;
      if (!this.canSendTimesheetEgress || !preview) return;
      this.timesheetEgressBusy = true;
      this.timesheetEgressError = '';
      this.timesheetEgressNotice = '';
      try {
        const client = getClient().req;
        const approval = await client.post('/api/0/egress/approve', {
          preview_id: preview.decision.preview_id,
          scope: 'once',
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        await client.post('/api/0/egress/send', {
          preview_id: preview.decision.preview_id,
          approval_id: approval.data.approval_id,
        });
        this.clearTimesheetEgressPreview();
        this.timesheetEgressNotice = 'The timesheet was sent once; the Privacy Firewall recorded a content-free receipt.';
      } catch (_) {
        this.clearTimesheetEgressPreview();
        this.timesheetEgressError = 'The send could not be confirmed. Check the Privacy Firewall receipt before retrying; no automatic retry was made.';
      } finally {
        this.timesheetEgressBusy = false;
      }
    },

    exportApprovedTimesheet() {
      if (!this.timesheetPreview) return;
      this.downloadFile(
        this.timesheetPreview.artifact_json,
        `approved-timesheet-${this.timesheetPreview.timesheet.project_alias}-${this.timesheetPreview.timesheet.date}.json`,
        'application/json',
      );
    },

    exportApprovedTimesheetCsv() {
      if (!this.timesheetPreview) return;
      this.downloadFile(
        this.approvedTimesheetCsv,
        `approved-timesheet-${this.timesheetPreview.timesheet.project_alias}-${this.timesheetPreview.timesheet.date}.csv`,
        'text/csv',
      );
    },

    exportInvoiceDraft() {
      if (!this.invoiceDraft) return;
      this.downloadFile(
        JSON.stringify(this.invoiceDraft),
        `invoice-draft-${this.invoiceDraft.project_alias}-${this.invoiceDraft.period_start}.json`,
        'application/json',
      );
    },

    exportProjectProfitabilityCsv() {
      const rows = this.projectProfitabilityReport.rows;
      if (!rows.length) return;
      this.downloadFile(
        serializeProjectProfitabilityCsv(rows),
        `project-profitability-${this.dateRange}.csv`,
        'text/csv',
      );
    },

    downloadFile(content: string, filename: string, mimeType: string) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
  },
};
</script>

<style scoped>
.table {
  font-size: 0.9rem;
}
</style>

<style>
#approved-timesheet-print { display: none; }
@media print {
  body.timesheet-print-mode * { visibility: hidden !important; }
  body.timesheet-print-mode #approved-timesheet-print,
  body.timesheet-print-mode #approved-timesheet-print * { visibility: visible !important; }
  body.timesheet-print-mode #approved-timesheet-print {
    display: block !important;
    position: fixed;
    inset: 0;
    padding: 1.5rem;
    background: #fff;
    color: #111;
    font: 12pt sans-serif;
  }
}
</style>
