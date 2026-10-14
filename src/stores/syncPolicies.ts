import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { getClient } from '~/util/awclient';
import {
  parsePolicyContext,
  parsePolicyPage,
  parsePolicyPreview,
  parsePolicyChoice,
  policyChoiceBody,
  type PolicyCandidate,
  type PolicyPreview,
  type PolicyChoiceResult,
  type PolicyDecision,
  type PolicyField,
} from '~/util/policyContracts';

type Failure =
  | 'source-unavailable'
  | 'invalid-response'
  | 'context-changed'
  | 'stale-review'
  | 'request-failed'
  | 'draft'
  | 'reload-pending';
type Ticket = { generation: number; sequence: number; context?: string };
const invalid = () => new Error('invalid-policy-response');
export const useSyncPolicyStore = defineStore('sync-policies', () => {
  const candidates = shallowRef<PolicyCandidate[]>([]),
    nextCursor = ref<string | null>(null),
    preview = shallowRef<PolicyPreview | null>(null);
  const selectedId = ref(''),
    busy = ref(false),
    error = ref<Failure | null>(null),
    notice = ref<'kept' | 'accepted' | null>(null);
  const reloadPending = ref<PolicyField | null>(null),
    lastChoice = shallowRef<PolicyChoiceResult | null>(null);
  let generation = 0,
    sequence = 0,
    disposed = false,
    contextId: string | undefined,
    previewContext: string | undefined,
    ackOwner: Ticket | null = null;
  const controllers = new Set<AbortController>();
  const current = (t: Ticket) =>
    !disposed && generation === t.generation && sequence === t.sequence;
  function invalidate() {
    generation++;
    sequence++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    busy.value = false;
  }
  function clearSensitive() {
    invalidate();
    candidates.value = [];
    nextCursor.value = null;
    preview.value = null;
    selectedId.value = '';
    reloadPending.value = null;
    lastChoice.value = null;
    notice.value = null;
    error.value = null;
    contextId = previewContext = undefined;
    ackOwner = null;
  }
  onScopeDispose(() => {
    disposed = true;
    clearSensitive();
  });
  function clearSelection() {
    if (reloadPending.value) {
      error.value = 'reload-pending';
      return;
    }
    invalidate();
    preview.value = null;
    selectedId.value = '';
    previewContext = undefined;
    error.value = null;
  }
  function begin(): Ticket {
    sequence++;
    busy.value = true;
    error.value = null;
    notice.value = null;
    return { generation, sequence, context: contextId };
  }
  function failure(t: Ticket, value: any) {
    if (current(t))
      error.value =
        value?.message === 'invalid-policy-response'
          ? 'invalid-response'
          : value?.response?.status === 409
          ? 'stale-review'
          : 'request-failed';
  }
  async function rawRequest(method: 'get' | 'post', path: string, body?: unknown): Promise<string> {
    const controller = new AbortController();
    controllers.add(controller);
    const options = {
      signal: controller.signal,
      responseType: 'text' as const,
      transformResponse: [(data: any) => data],
      ...(typeof body === 'string' ? { headers: { 'Content-Type': 'application/json' } } : {}),
    };
    try {
      const request = getClient().req;
      const response =
        method === 'get'
          ? await request.get(path, options)
          : await request.post(path, body, options);
      if (typeof response.data !== 'string') throw invalid();
      return response.data;
    } finally {
      controllers.delete(controller);
    }
  }
  async function ready(t: Ticket): Promise<boolean> {
    if (!current(t)) return false;
    try {
      const raw = await rawRequest('get', '/0/sync/policies/context');
      if (!current(t)) return false;
      let context: string;
      try {
        context = parsePolicyContext(raw).context_id;
      } catch (_) {
        throw invalid();
      }
      if (t.context !== undefined && t.context !== context) {
        clearSensitive();
        if (!disposed) error.value = 'context-changed';
        return false;
      }
      t.context = context;
      contextId = context;
      return true;
    } catch (value) {
      if (current(t)) {
        const status=value?.response?.status;
        if (ackOwner === t && lastChoice.value?.applied && ![401,403,423].includes(status)) {
          candidates.value=[];nextCursor.value=null;preview.value=null;selectedId.value='';previewContext=undefined;
        } else clearSensitive();
        if (!disposed)
          error.value =
            value?.message === 'invalid-policy-response'
              ? 'invalid-response'
              : 'source-unavailable';
      }
      return false;
    }
  }
  async function load(after: string | null = null) {
    if (disposed) return;
    if (reloadPending.value) {
      error.value = 'reload-pending';
      return;
    }
    clearSelection();
    const t = begin();
    try {
      if (!(await ready(t))) return;
      const raw = await rawRequest('post', '/0/sync/policies/list', {
        schema_version: 1,
        after,
        limit: 32,
      });
      if (!(await ready(t))) return;
      let page;
      try {
        page = parsePolicyPage(raw);
      } catch (_) {
        throw invalid();
      }
      if (after !== null) {
        if (nextCursor.value !== after) throw invalid();
        const merged = [...candidates.value, ...page.candidates];
        if (merged.some((item, i) => i > 0 && merged[i - 1].candidate_id >= item.candidate_id))
          throw invalid();
        candidates.value = merged;
      } else candidates.value = page.candidates;
      nextCursor.value = page.next_cursor;
    } catch (value) {
      failure(t, value);
    } finally {
      if (current(t)) busy.value = false;
    }
  }
  async function select(id: string) {
    if (disposed) return;
    if (reloadPending.value) {
      error.value = 'reload-pending';
      return;
    }
    clearSelection();
    const selected = candidates.value.find(item => item.candidate_id === id);
    if (!selected) {
      error.value = 'stale-review';
      return;
    }
    selectedId.value = id;
    const t = begin();
    try {
      if (!(await ready(t))) return;
      const raw = await rawRequest('post', '/0/sync/policies/preview', {
        schema_version: 1,
        candidate_id: id,
      });
      if (!(await ready(t))) return;
      try {
        preview.value = parsePolicyPreview(raw, selected);
      } catch (_) {
        throw invalid();
      }
      previewContext = t.context;
    } catch (value) {
      failure(t, value);
    } finally {
      if (current(t)) busy.value = false;
    }
  }
  async function choose(
    decision: PolicyDecision,
    dirty: () => boolean
  ): Promise<PolicyChoiceResult | null> {
    const reviewed = preview.value;
    if (!reviewed || !previewContext || busy.value) return null;
    if (decision === 'accept-remote' && dirty()) {
      error.value = 'draft';
      return null;
    }
    const t = begin();
    t.context = previewContext;
    const expected = { field: reviewed.policy.candidate.field, decision };
    try {
      if (!(await ready(t))) return null;
      if (decision === 'accept-remote' && dirty()) {
        error.value = 'draft';
        return null;
      }
      const body = policyChoiceBody(reviewed, decision);
      const raw = await rawRequest('post', '/0/sync/policies/choice', body);
      if (!current(t)) return null;
      let ack;
      try {
        ack = parsePolicyChoice(raw, expected);
      } catch (_) {
        throw invalid();
      }
      candidates.value = candidates.value.filter(item => item.field !== ack.field);
      preview.value = null;
      selectedId.value = '';
      previewContext = undefined;
      notice.value = ack.applied ? 'accepted' : 'kept';
      if (ack.applied) {
        reloadPending.value = ack.field;
        lastChoice.value = ack;
        ackOwner = t;
      }
      if (!(await ready(t))) return current(t) && lastChoice.value === ack ? ack : null;
      return ack;
    } catch (value) {
      failure(t, value);
      return null;
    } finally {
      if (current(t)) busy.value = false;
    }
  }
  async function canApplyChoice(ack: PolicyChoiceResult, dirty: () => boolean): Promise<boolean> {
    const t = ackOwner;
    if (!t || lastChoice.value !== ack || !current(t) || !ack.applied || dirty()) return false;
    if (!(await ready(t)) || dirty()) return false;
    return current(t) && lastChoice.value === ack;
  }
  function markReloaded(ack: PolicyChoiceResult) {
    if (ackOwner && current(ackOwner) && lastChoice.value === ack) {
      reloadPending.value = null;
      lastChoice.value = null;
      ackOwner = null;
    }
  }
  const hasMore = computed(() => nextCursor.value !== null);
  return {
    candidates,
    nextCursor,
    hasMore,
    preview,
    selectedId,
    busy,
    error,
    notice,
    reloadPending,
    lastChoice,
    load,
    select,
    choose,
    canApplyChoice,
    markReloaded,
    clearSelection,
    clearSensitive,
  };
});
