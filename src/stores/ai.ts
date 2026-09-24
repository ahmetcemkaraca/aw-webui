import { defineStore } from 'pinia';
import { getClient } from '~/util/awclient';

export type AIMode = 'off' | 'peak_ai' | 'custom_endpoint';
export type AIDestinationType = 'remote' | 'self_hosted' | 'lan' | 'paired_device' | 'central_sync_device';
export type AIAuthentication = 'none' | 'bearer';

export interface AIEndpointProfile {
  profile_id: string;
  display_name: string;
  origin: string;
  endpoint_path: string;
  protocol: 'openai_chat_completions_v1';
  authentication: AIAuthentication;
  model_id: string;
  destination_type: AIDestinationType;
  region_note: string;
  retention_note: string;
  training_note: string;
  cost_note: string | null;
  credential_ref: string | null;
  resolved_addresses: string[];
}

export interface AISettings {
  schema_version: 1;
  revision: number;
  mode: AIMode;
  active_connection_id: string | null;
  profiles: AIEndpointProfile[];
}

export interface AIStatus {
  schema_version: 1;
  mode: AIMode;
  revision: number;
  peak_ai_available: boolean;
  custom_endpoint_available: boolean;
  native_secret_store_available: boolean;
}

export interface AIRequestPreview {
  profile_id: string;
  origin: string;
  model_id: string;
  purpose_id: string;
  retention_disclosure: string;
  decision: {
    outcome: 'allow' | 'deny';
    sanitized_payload: unknown;
    removed_fields: string[];
    reason_codes: string[];
    preview_id: string;
  };
}

export interface AIResult {
  schema_version: 1;
  source_mode: AIMode;
  profile_label: string;
  model_id: string;
  text: string;
}

export interface AIInsight {
  insight_id: string;
  created_at: string;
  source_mode: AIMode;
  profile_label: string;
  model_id: string;
  feature: AIUserRequest['feature'];
  text: string;
}

interface AIUserRequest {
  schema_version: 1;
  profile_id: string;
  feature: 'question_answer' | 'report_explanation' | 'category_suggestion' | 'freelancer_draft' | 'pattern_comparison';
  question: string;
  aggregate: Record<string, unknown>;
}

interface Approval {
  approval_id: string;
  preview_id: string;
  profile_id: string;
  feature: AIUserRequest['feature'];
}

function native(command: string, args?: object): Promise<any> {
  const bridge = (window as unknown as {
    __TAURI__?: { core: { invoke: (name: string, values?: object) => Promise<unknown> } };
  }).__TAURI__;
  if (!bridge) return Promise.reject(new Error('The native secret store is unavailable on this platform.'));
  return args === undefined ? bridge.core.invoke(command) : bridge.core.invoke(command, args);
}

function message(error: unknown): string {
  const response = (error as any)?.response?.data?.message;
  return typeof response === 'string' ? response : error instanceof Error ? error.message : 'AI controls are unavailable.';
}

export const useAIStore = defineStore('ai', {
  state: () => ({
    settings: null as AISettings | null,
    status: null as AIStatus | null,
    credentialStatus: {} as Record<string, boolean>,
    preview: null as AIRequestPreview | null,
    previewFeature: null as AIUserRequest['feature'] | null,
    approval: null as Approval | null,
    result: null as AIResult | null,
    resultFeature: null as AIUserRequest['feature'] | null,
    previewRequestId: 0,
    history: [] as AIInsight[],
    busy: false,
    busyCount: 0,
    error: '',
  }),
  actions: {
    beginBusy() {
      this.busyCount += 1;
      this.busy = true;
    },
    endBusy() {
      this.busyCount = Math.max(0, this.busyCount - 1);
      this.busy = this.busyCount > 0;
    },
    clearPreview() {
      this.previewRequestId += 1;
      this.preview = null;
      this.previewFeature = null;
      this.approval = null;
      this.result = null;
      this.resultFeature = null;
    },
    async refresh(): Promise<boolean> {
      this.error = '';
      try {
        const client = getClient();
        const [settings, status] = await Promise.all([
          client.req.get('/api/0/ai/settings'),
          client.req.get('/api/0/ai/status'),
        ]);
        this.settings = settings.data as AISettings;
        this.status = status.data as AIStatus;
        return true;
      } catch (error) {
        this.error = message(error);
        return false;
      }
    },
    async loadHistory(): Promise<boolean> {
      this.error = '';
      try {
        const response = await getClient().req.get('/api/0/ai/history');
        this.history = response.data.insights as AIInsight[];
        return true;
      } catch (error) {
        this.error = message(error);
        return false;
      }
    },
    async saveResult(feature: AIInsight['feature']): Promise<boolean> {
      if (!this.result || this.resultFeature !== feature) return false;
      this.beginBusy();
      this.error = '';
      try {
        const response = await getClient().req.post('/api/0/ai/history', { feature, result: this.result });
        this.history = response.data.insights as AIInsight[];
        return true;
      } catch (error) {
        this.error = message(error);
        return false;
      } finally {
        this.endBusy();
      }
    },
    async deleteInsight(insightId: string): Promise<boolean> {
      this.beginBusy();
      this.error = '';
      try {
        await getClient().req.delete(`/api/0/ai/history/${encodeURIComponent(insightId)}`);
        this.history = this.history.filter(item => item.insight_id !== insightId);
        return true;
      } catch (error) {
        this.error = message(error);
        return false;
      } finally {
        this.endBusy();
      }
    },
    async saveCredential(secret: string): Promise<string | null> {
      this.error = '';
      try {
        const reference = await native('save_ai_credential', { secret }) as string;
        this.credentialStatus[reference] = true;
        return reference;
      } catch (error) {
        this.error = message(error);
        return null;
      }
    },
    async deleteCredential(credentialRef: string): Promise<boolean> {
      this.error = '';
      try {
        await native('delete_ai_credential', { credentialRef });
        this.credentialStatus[credentialRef] = false;
        return true;
      } catch (error) {
        this.error = message(error);
        return false;
      }
    },
    async hasCredential(credentialRef: string): Promise<boolean | null> {
      this.error = '';
      try {
        const available = await native('has_ai_credential', { credentialRef }) as boolean;
        this.credentialStatus[credentialRef] = available;
        return available;
      } catch (error) {
        this.error = message(error);
        return null;
      }
    },
    async testConnection(profile: AIEndpointProfile): Promise<{ http_status: number; resolved_addresses: string[] } | null> {
      this.beginBusy();
      this.error = '';
      try {
        const response = await getClient().req.post('/api/0/ai/connection-test', { profile });
        return response.data;
      } catch (error) {
        this.error = message(error);
        return null;
      } finally {
        this.endBusy();
      }
    },
    async saveSettings(settings: AISettings): Promise<boolean> {
      if (!this.settings) return false;
      this.beginBusy();
      this.error = '';
      try {
        const response = await getClient().req.put('/api/0/ai/settings', {
          expected_revision: this.settings.revision,
          settings,
        });
        this.settings = response.data as AISettings;
        this.clearPreview();
        await this.refresh();
        return true;
      } catch (error) {
        this.error = message(error);
        return false;
      } finally {
        this.endBusy();
      }
    },
    async preview(request: AIUserRequest): Promise<boolean> {
      this.error = '';
      this.clearPreview();
      const requestId = this.previewRequestId;
      if (this.settings?.mode !== 'custom_endpoint'
        || this.settings.active_connection_id !== request.profile_id
        || !this.status?.custom_endpoint_available) {
        this.error = 'AI is Off or Custom Endpoint is unavailable.';
        return false;
      }
      this.beginBusy();
      try {
        const response = await getClient().req.post('/api/0/ai/preview', request);
        if (requestId !== this.previewRequestId) return false;
        this.preview = response.data as AIRequestPreview;
        this.previewFeature = request.feature;
        return true;
      } catch (error) {
        if (requestId === this.previewRequestId) {
          this.error = message(error);
          this.preview = null;
          this.previewFeature = null;
          this.approval = null;
        }
        return false;
      } finally {
        this.endBusy();
      }
    },
    async approve(profileId: string, feature: AIUserRequest['feature']): Promise<boolean> {
      const preview = this.preview;
      if (!preview || this.previewFeature !== feature || preview.profile_id !== profileId || preview.decision.outcome !== 'allow') return false;
      const requestId = this.previewRequestId;
      this.beginBusy();
      this.error = '';
      try {
        const response = await getClient().req.post('/api/0/ai/approve', {
          profile_id: profileId,
          preview_id: preview.decision.preview_id,
          scope: 'once',
          expires_at: null,
        });
        if (requestId !== this.previewRequestId || this.preview?.decision.preview_id !== preview.decision.preview_id) return false;
        this.approval = {
          approval_id: response.data.approval_id,
          preview_id: preview.decision.preview_id,
          profile_id: profileId,
          feature,
        };
        return true;
      } catch (error) {
        if (requestId === this.previewRequestId) this.error = message(error);
        return false;
      } finally {
        this.endBusy();
      }
    },
    async send(profileId: string, feature: AIUserRequest['feature']): Promise<boolean> {
      const preview = this.preview;
      const approval = this.approval;
      const profile = this.settings?.profiles.find(item => item.profile_id === profileId);
      if (!preview || !approval || !profile || preview.profile_id !== profileId
        || this.previewFeature !== feature || approval.preview_id !== preview.decision.preview_id
        || approval.profile_id !== profileId || approval.feature !== feature
        || preview.decision.outcome !== 'allow') return false;
      const requestId = this.previewRequestId;
      this.beginBusy();
      this.error = '';
      try {
        const result = await native('send_ai_request', {
          profileId: profile.profile_id,
          credentialRef: profile.credential_ref,
          previewId: preview.decision.preview_id,
          approvalId: approval.approval_id,
        }) as AIResult;
        if (requestId !== this.previewRequestId || this.preview?.decision.preview_id !== preview.decision.preview_id) return false;
        this.result = result;
        this.resultFeature = feature;
        this.preview = null;
        this.previewFeature = null;
        this.approval = null;
        return true;
      } catch (error) {
        if (requestId === this.previewRequestId) {
          this.error = message(error);
          this.preview = null;
          this.previewFeature = null;
          this.approval = null;
        }
        return false;
      } finally {
        this.endBusy();
      }
    },
  },
});
