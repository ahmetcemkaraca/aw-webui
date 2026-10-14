import { useSettingsStore } from '~/stores/settings';
import { useCategoryStore } from '~/stores/categories';
import { useViewsStore } from '~/stores/views';
import { useCaptureStore } from '~/stores/capture';
import { hasPolicyDrafts, hasPolicyEditor, reloadPolicyDrafts } from './policyDrafts';
import type { PolicyChoiceResult } from './policyContracts';

export function policyBlocked(): boolean {
  const settings = useSettingsStore(),
    capture = useCaptureStore();
  return (
    !settings.loaded ||
    !!settings._pendingPolicyWrites ||
    useCategoryStore().hasPolicyDraft ||
    useViewsStore().hasPolicyDraft ||
    capture.busy ||
    capture.pausing ||
    hasPolicyDrafts()
  );
}

export async function applyPolicyChoice(
  ack: PolicyChoiceResult,
  stillCurrent: () => Promise<boolean>
): Promise<boolean> {
  if (!ack.applied) return true;
  const owned = async () => !policyBlocked() && (await stillCurrent()) && !policyBlocked();
  try {
    if (!(await owned())) return false;
    if (ack.field.startsWith('settings.')) {
      const settings = useSettingsStore();
      if (!(await settings.reloadPolicy(ack.field, owned)) || !(await owned())) return false;
      if (
        ['settings.classes', 'settings.category_sets', 'settings.active_set_ids'].includes(
          ack.field
        )
      )
        useCategoryStore().load();
      if (ack.field === 'settings.views') useViewsStore().loadViews(settings.views);
    }
    if (
      ack.field === 'capture.minimization' &&
      !hasPolicyEditor(ack.field) &&
      !(await useCaptureStore().reloadPolicy(owned))
    )
      return false;
    return (await reloadPolicyDrafts(ack.field, owned)) && (await owned());
  } catch (_) {
    return false;
  }
}
