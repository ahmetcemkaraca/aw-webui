<template lang="pug">
main.container.my-3
  h1 Freelancer workspace
  p Manage local project aliases and category mappings. Projects remain inside the encrypted Local Vault.
  b-alert(show variant="warning" role="status" v-if="!freelancerAvailable")
    | Freelancer: {{ capabilityStatus }}. New projects and corrections require access. Existing settings remain available to read, export and remove.
  template
    b-alert(v-if="loading" show variant="info" role="status") Loading local project settings…
    b-alert(v-if="error" show variant="danger" role="alert") {{ error }}
    b-alert(v-if="saveMessage" show variant="success" role="status") {{ saveMessage }}

    section(v-if="!loading" aria-labelledby="project-create-title")
      h2#project-create-title {{ editingProjectAlias ? 'Edit local project' : 'Add a local project' }}
      p.small.text-muted Choose a non-identifying project alias. The alias is the only project field allowed in an Approved Timesheet; the label stays local.
      b-form-group(label="Private project label" label-for="project-label")
        b-form-input#project-label(v-model.trim="draft.label" maxlength="120" autocomplete="off")
      b-form-group(label="Project alias" label-for="project-alias")
        b-input-group
          b-form-input#project-alias(v-model.trim="draft.project_alias" maxlength="64" autocomplete="off" :disabled="!!editingProjectAlias")
          b-input-group-append(v-if="!editingProjectAlias")
            b-button(variant="outline-secondary" type="button" @click="draft.project_alias = newAlias()") Generate opaque alias
      b-form-group(label="Local client alias (optional)" label-for="client-alias")
        b-input-group
          b-form-input#client-alias(v-model.trim="draft.client_alias" maxlength="64" autocomplete="off")
          b-input-group-append
            b-button(variant="outline-secondary" type="button" @click="draft.client_alias = newAlias('client')") Generate local client alias
        small.form-text.text-muted A local grouping only; the alias is never included in an Approved Timesheet.
      b-form-group(label="Category paths" label-for="project-categories")
      b-form-select#project-categories(v-model="draft.category_paths" :options="categoryOptions" multiple :select-size="4")
      b-form-checkbox.mb-3(v-model="draft.billable_default") Default to billable time
      b-form-row
        b-col(md="6")
          b-form-group(label="Currency code" label-for="project-currency")
            b-form-input#project-currency(v-model.trim="draft.currency_code" maxlength="3" placeholder="EUR" autocomplete="off")
        b-col(md="6" v-if="draft.billable_default")
          b-form-group(label="Hourly rate in minor units" label-for="project-rate")
            b-form-input#project-rate(v-model="draft.hourly_rate_minor" type="number" min="0" step="1" inputmode="numeric")
      b-form-row
        b-col(md="6")
          b-form-group(label="Hourly cost in minor units (optional)" label-for="project-cost")
            b-form-input#project-cost(v-model="draft.hourly_cost_minor" type="number" min="0" step="1" inputmode="numeric")
      b-form-row
        b-col(md="6")
          b-form-group(label="Rounding" label-for="project-rounding")
            b-form-select#project-rounding(v-model="draft.rounding_mode" :options="roundingModes")
        b-col(md="6" v-if="draft.rounding_mode !== 'none'")
          b-form-group(label="Rounding increment (seconds)" label-for="project-increment")
            b-form-input#project-increment(v-model.number="draft.rounding_increment_seconds" type="number" min="1" max="3600" step="1")
      b-button(variant="primary" type="button" @click="addProject" :disabled="!canAddProject") {{ editingProjectAlias ? 'Save project correction locally' : 'Add project locally' }}
      b-button.ml-2(v-if="editingProjectAlias" variant="outline-secondary" type="button" @click="cancelProjectEdit") Cancel correction

    section.mt-4(aria-labelledby="projects-title")
      h2#projects-title Local projects
      p(v-if="!workspace.projects.length") No local projects have been added.
      ul(v-else class="list-unstyled")
        li.border.rounded.p-3.mb-2(v-for="project in workspace.projects" :key="project.project_alias")
          h3.h5 {{ project.label }}
          p.mb-1 Project alias: #[code {{ project.project_alias }}]
          p.mb-1(v-if="project.client_alias") Local client alias: #[code {{ project.client_alias }}]
          p.mb-1 Categories: {{ categoriesForProject(project.project_alias) || 'None mapped' }}
          p.mb-1 Default billable: {{ project.billable_default ? 'Yes' : 'No' }}
          p.mb-1(v-if="project.hourly_rate_minor !== null") Local income rate: {{ project.hourly_rate_minor }} {{ project.currency_code }} minor units per hour.
          p.mb-2(v-if="project.hourly_cost_minor !== null") Local cost rate: {{ project.hourly_cost_minor }} {{ project.currency_code }} minor units per hour.
          b-button.mr-2(size="sm" variant="outline-primary" type="button" @click="editProject(project.project_alias)" :disabled="!freelancerAvailable") Edit project
          b-button(size="sm" variant="outline-danger" type="button" @click="removeProject(project.project_alias)") Remove project

    div.mt-3
      b-button(variant="success" type="button" @click="saveWorkspace" :disabled="!dirty || saving || (!freelancerAvailable && !removalOnly)")
        | {{ saving ? 'Saving…' : 'Save local project settings' }}
      b-button.ml-2(variant="outline-secondary" type="button" @click="exportWorkspace" :disabled="!workspace.projects.length") Export local project settings
    p.small.text-muted.mt-3 No client or accounting integrations are configured. A category rule is a local suggestion; only a separately reviewed Approved Timesheet can be exported.
</main>
</template>

<script lang="ts">
import experience from '~/generated/product-experience.json';
import { capability, isShipped, statusLabel } from '~/product/experience';
import { hasFeatureEntitlement, loadNativeEntitlementStatus } from '~/util/entitlement';
import { getClient } from '~/util/awclient';
import { downloadFile } from '~/util/export';
import { useCategoryStore } from '~/stores/categories';
import { updateFreelancerProject } from '~/util/freelancer';
import type { FreelancerProjectV1, FreelancerWorkspaceV1 } from '~/util/freelancer';

const emptyWorkspace = (): FreelancerWorkspaceV1 => ({
  schema_version: 1,
  revision: 0,
  projects: [],
  category_rules: [],
});

export default {
  name: 'Freelancer',
  data() {
    return {
      categoryStore: useCategoryStore(),
      workspace: emptyWorkspace(),
      savedWorkspace: null as FreelancerWorkspaceV1 | null,
      draft: {
        label: '',
        project_alias: '',
        client_alias: '',
        category_paths: [] as string[][],
        billable_default: true,
        currency_code: '',
        hourly_rate_minor: '' as string | number,
        hourly_cost_minor: '' as string | number,
        rounding_mode: 'nearest' as FreelancerProjectV1['rounding_mode'],
        rounding_increment_seconds: 900,
      },
      editingProjectAlias: '',
      loading: false,
      entitlementAvailable: false,
      entitlementCheckComplete: false,
      entitlementRevision: 0,
      saving: false,
      dirty: false,
      error: '',
      saveMessage: '',
    };
  },
  computed: {
    freelancerAvailable(): boolean { return this.entitlementAvailable; },
    removalOnly(): boolean {
      const saved = this.savedWorkspace;
      if (!saved) return false;
      const projects = saved.projects.filter(project => this.workspace.projects.some(item => item.project_alias === project.project_alias));
      const rules = saved.category_rules.filter(rule => this.workspace.category_rules.some(item => JSON.stringify(item.category_path) === JSON.stringify(rule.category_path)));
      return JSON.stringify(projects) === JSON.stringify(this.workspace.projects)
        && JSON.stringify(rules) === JSON.stringify(this.workspace.category_rules)
        && (projects.length < saved.projects.length || rules.length < saved.category_rules.length
          || JSON.stringify(this.workspace) === JSON.stringify(saved));
    },
    capabilityStatus(): string {
      if (!isShipped('freelancer-workspace', experience)) return statusLabel('freelancer-workspace', experience);
      if (!this.entitlementCheckComplete) return 'Checking local plan access';
      return this.entitlementAvailable ? 'Available' : 'Freelancer plan required or entitlement unavailable';
    },
    categoryOptions(): { value: string[]; text: string }[] {
      const assigned = new Set(this.workspace.category_rules
        .filter(rule => rule.project_alias !== this.editingProjectAlias)
        .map(rule => JSON.stringify(rule.category_path)));
      return (this.categoryStore.all_categories || [])
        .filter(path => !assigned.has(JSON.stringify(path)))
        .map(path => ({ value: path, text: path.join(' > ') }));
    },
    roundingModes(): { value: string; text: string }[] {
      return [
        { value: 'none', text: 'No rounding' },
        { value: 'nearest', text: 'Nearest increment (half up)' },
        { value: 'up', text: 'Round up' },
        { value: 'down', text: 'Round down' },
      ];
    },
    canAddProject(): boolean {
      const label = this.draft.label.trim();
      const alias = this.draft.project_alias.trim();
      const clientAlias = this.draft.client_alias.trim();
      const hasCategories = this.draft.category_paths.length > 0;
      const hasRate = String(this.draft.hourly_rate_minor).trim() !== '';
      const hasCost = String(this.draft.hourly_cost_minor).trim() !== '';
      const currency = this.draft.currency_code.trim();
      const rate = hasRate ? Number(this.draft.hourly_rate_minor) : null;
      const cost = hasCost ? Number(this.draft.hourly_cost_minor) : null;
      const billingFieldsValid = (!hasRate && !hasCost)
        || (!!currency && /^[A-Z]{3}$/.test(currency)
          && (!hasRate || (rate !== null && Number.isSafeInteger(rate) && rate >= 0))
          && (!hasCost || (cost !== null && Number.isSafeInteger(cost) && cost >= 0)));
      const aliasAvailable = this.editingProjectAlias === alias
        || !this.workspace.projects.some(project => project.project_alias === alias);
      return this.freelancerAvailable && !!label && aliasAvailable
        && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(alias)
        && (!clientAlias || /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(clientAlias))
        && hasCategories && billingFieldsValid;
    },
  },
  async mounted() {
    this.loading = true;
    this.error = '';
    this.refreshFreelancerEntitlement();
    this.categoryStore.load().catch(() => {
      this.error = 'Category settings are unavailable. Existing projects can still be exported or removed.';
    });
    try {
      const response = await getClient().req.get('/0/freelancer/workspace');
      this.workspace = response.data as FreelancerWorkspaceV1;
      this.savedWorkspace = JSON.parse(JSON.stringify(this.workspace)) as FreelancerWorkspaceV1;
    } catch (_) {
      this.error = 'Local Freelancer settings are unavailable. Unlock the vault and retry.';
    } finally {
      this.loading = false;
    }
  },
  methods: {
    async refreshFreelancerEntitlement(): Promise<boolean> {
      const revision = ++this.entitlementRevision;
      const entitlement = await loadNativeEntitlementStatus();
      if (revision !== this.entitlementRevision) return false;
      this.entitlementAvailable = hasFeatureEntitlement(
        capability('freelancer-workspace', experience)?.status,
        entitlement, 'freelancer-workspace',
      );
      this.entitlementCheckComplete = true;
      return this.freelancerAvailable;
    },
    newAlias(prefix: 'project' | 'client' = 'project'): string {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return `${prefix}-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
    },
    categoriesForProject(alias: string): string {
      return this.workspace.category_rules.filter(rule => rule.project_alias === alias)
        .map(rule => rule.category_path.join(' > ')).join(', ');
    },
    async editProject(alias: string) {
      if (!await this.refreshFreelancerEntitlement()) {
        this.error = 'Project corrections require current Freelancer access. Your local input is preserved.';
        return;
      }
      const project = this.workspace.projects.find(item => item.project_alias === alias);
      if (!project) return;
      this.editingProjectAlias = alias;
      this.draft = {
        label: project.label,
        project_alias: project.project_alias,
        client_alias: project.client_alias || '',
        category_paths: this.workspace.category_rules
          .filter(rule => rule.project_alias === alias)
          .map(rule => [...rule.category_path]),
        billable_default: project.billable_default,
        currency_code: project.currency_code || '',
        hourly_rate_minor: project.hourly_rate_minor ?? '',
        hourly_cost_minor: project.hourly_cost_minor ?? '',
        rounding_mode: project.rounding_mode,
        rounding_increment_seconds: project.rounding_increment_seconds,
      };
      this.error = '';
      this.saveMessage = '';
    },
    cancelProjectEdit() {
      this.editingProjectAlias = '';
      this.draft = {
        label: '', project_alias: this.newAlias(), category_paths: [], billable_default: true,
        client_alias: '', currency_code: '', hourly_rate_minor: '', hourly_cost_minor: '',
        rounding_mode: 'nearest', rounding_increment_seconds: 900,
      };
    },
    async addProject() {
      if (!await this.refreshFreelancerEntitlement()) {
        this.error = 'New projects and corrections require current Freelancer access. Your local input is preserved.';
        return;
      }
      if (!this.canAddProject) return;
      const projectAlias = this.draft.project_alias.trim();
      if (!this.editingProjectAlias && this.workspace.projects.some(project => project.project_alias === projectAlias)) {
        this.error = 'That project alias already exists.';
        return;
      }
      const hasRate = String(this.draft.hourly_rate_minor).trim() !== '';
      const hasCost = String(this.draft.hourly_cost_minor).trim() !== '';
      const rate = hasRate ? Number(this.draft.hourly_rate_minor) : null;
      const cost = hasCost ? Number(this.draft.hourly_cost_minor) : null;
      if ((rate !== null && (!Number.isSafeInteger(rate) || rate < 0))
          || (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))) {
        this.error = 'Enter whole-number rates in minor currency units.';
        return;
      }
      this.error = '';
      const project: FreelancerProjectV1 = {
        project_alias: projectAlias,
        client_alias: this.draft.client_alias.trim() || null,
        label: this.draft.label.trim(),
        billable_default: this.draft.billable_default,
        rounding_increment_seconds: this.draft.rounding_mode === 'none' ? 0 : Number(this.draft.rounding_increment_seconds),
        rounding_mode: this.draft.rounding_mode,
        currency_code: rate === null && cost === null ? null : this.draft.currency_code.trim(),
        hourly_rate_minor: rate,
        hourly_cost_minor: cost,
      };
      if (this.editingProjectAlias) {
        this.workspace = updateFreelancerProject(this.workspace, project, this.draft.category_paths);
      } else {
        this.workspace.projects.push(project);
        for (const path of this.draft.category_paths) {
          if (!this.workspace.category_rules.some(rule => JSON.stringify(rule.category_path) === JSON.stringify(path))) {
            this.workspace.category_rules.push({ category_path: [...path], project_alias: projectAlias });
          }
        }
        this.workspace = { ...this.workspace };
      }
      this.dirty = true;
      this.saveMessage = '';
      this.cancelProjectEdit();
    },
    removeProject(alias: string) {
      this.workspace.projects = this.workspace.projects.filter(project => project.project_alias !== alias);
      this.workspace.category_rules = this.workspace.category_rules.filter(rule => rule.project_alias !== alias);
      this.workspace = { ...this.workspace };
      this.dirty = true;
      this.saveMessage = '';
    },
    async saveWorkspace() {
      if (!this.dirty || this.saving || !this.savedWorkspace) return;
      this.saving = true;
      this.error = '';
      try {
        if (!this.removalOnly && !await this.refreshFreelancerEntitlement()) {
          this.error = 'Saving project corrections requires current Freelancer access. Your unsaved settings are preserved.';
          return;
        }
        const expectedRevision = this.workspace.revision;
        const response = await getClient().req.put('/0/freelancer/workspace', {
          expected_revision: expectedRevision,
          workspace: { ...this.workspace, revision: expectedRevision },
        });
        this.workspace = response.data as FreelancerWorkspaceV1;
        this.savedWorkspace = JSON.parse(JSON.stringify(this.workspace)) as FreelancerWorkspaceV1;
        this.dirty = false;
        this.saveMessage = 'Local project settings saved in the encrypted vault.';
      } catch (error: any) {
        if (error?.response?.status === 403) {
          this.entitlementRevision += 1;
          this.entitlementAvailable = false;
        }
        this.error = error?.response?.status === 403
          ? 'Saving these settings was denied. Your unsaved settings are preserved; existing projects can still be exported or removed.'
          : error?.response?.status === 409
          ? 'Project settings changed elsewhere. Reload before saving.'
          : 'Project settings were not saved. Unlock the vault and retry.';
      } finally {
        this.saving = false;
      }
    },
    async exportWorkspace() {
      await downloadFile('freelancer-project-settings.json', JSON.stringify(this.workspace, null, 2), 'application/json');
    },
  },
};
</script>
