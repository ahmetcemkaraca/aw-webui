import type { PolicyField } from './policyContracts';

type Owned = () => Promise<boolean>;
type Editor = {
  fields: readonly PolicyField[];
  blocked: () => boolean;
  reload?: (stillCurrent: Owned) => void | Promise<void>;
};
const editors = new Set<Editor>();
let generation = 0;
const categoryFields: PolicyField[] = [
  'settings.classes',
  'settings.category_sets',
  'settings.active_set_ids',
];
const egressFields: PolicyField[] = ['egress.user_policy', 'egress.signed_bundle'];
function companions(field: PolicyField): readonly PolicyField[] {
  return categoryFields.includes(field)
    ? categoryFields
    : egressFields.includes(field)
    ? egressFields
    : [field];
}
export function registerPolicyDraft(
  fields: readonly PolicyField[],
  callbacks: Omit<Editor, 'fields'>
): () => void {
  const editor = { fields, ...callbacks };
  editors.add(editor);
  return () => {
    editors.delete(editor);
  };
}
export function hasPolicyDrafts(): boolean {
  for (const editor of editors) {
    try {
      if (editor.blocked()) return true;
    } catch (_) {
      return true;
    }
  }
  return false;
}
export function hasPolicyEditor(field: PolicyField): boolean {
  return [...editors].some(editor => editor.fields.includes(field) && !!editor.reload);
}
export function clearPolicyDrafts() {
  generation++;
  editors.clear();
}
export async function reloadPolicyDrafts(
  field: PolicyField,
  stillCurrent: Owned
): Promise<boolean> {
  const born = generation;
  const current = async () => {
    if (generation !== born || hasPolicyDrafts()) return false;
    const owned = await stillCurrent();
    return generation === born && owned && !hasPolicyDrafts();
  };
  if (!(await current())) return false;
  for (const editor of [...editors]) {
    if (!editor.fields.some(scope => companions(field).includes(scope)) || !editor.reload) continue;
    const owned = async () => editors.has(editor) && (await current()) && editors.has(editor);
    if (!(await owned())) return false;
    await editor.reload(owned);
    if (!(await current())) return false;
  }
  return current();
}
