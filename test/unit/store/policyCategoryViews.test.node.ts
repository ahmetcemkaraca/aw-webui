import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from '~/stores/settings';
import { useCategoryStore } from '~/stores/categories';
import { useViewsStore } from '~/stores/views';
const deferred = () => {
  let resolve!: (v?: any) => void, reject!: (v: any) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => setActivePinia(createPinia()));
test('category load detaches settings aliases and catches unflagged set/activation drafts', () => {
  const settings = useSettingsStore();
  settings.category_sets = [
    { id: 'Saved', categories: [{ name: ['Work'], rule: { type: 'none' } }] },
  ];
  settings.active_set_ids = ['Saved'];
  const categories = useCategoryStore();
  categories.load();
  expect(categories.hasPolicyDraft).toBe(false);
  categories.createSet('Unsaved');
  categories.switchToSet('Unsaved');
  expect(categories.classes_unsaved_changes).toBe(false);
  expect(categories.hasPolicyDraft).toBe(true);
  expect(settings.category_sets).toHaveLength(1);
  expect(settings.active_set_ids).toEqual(['Saved']);
});
test('legacy category virtual defaults establish a clean normalized baseline', () => {
  const settings = useSettingsStore();
  settings.category_sets = [];
  settings.classes = [];
  const categories = useCategoryStore();
  categories.load();
  expect(categories.category_sets[0].id).toBe('default');
  expect(categories.hasPolicyDraft).toBe(false);
});
test('category save acknowledges only its captured data and retains later edits', async () => {
  const settings = useSettingsStore();
  settings.category_sets = [
    { id: 'Saved', categories: [{ name: ['Work'], rule: { type: 'regex', regex: 'old' } }] },
  ];
  settings.active_set_ids = ['Saved'];
  const categories = useCategoryStore();
  categories.load();
  const pending = deferred();
  const update = jest.spyOn(settings, 'update').mockReturnValue(pending.promise);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    categories.appendClassRule(0, 'first');
    const saving = categories.save();
    expect(categories._pendingPolicyWrites).toBeGreaterThan(0);
    categories.appendClassRule(0, 'later');
    expect(update.mock.calls[0][0].category_sets[0].categories[0].rule.regex).not.toContain(
      'later'
    );
    pending.resolve();
    await saving;
    expect(categories.hasPolicyDraft).toBe(true);
    expect(categories.classes_unsaved_changes).toBe(true);
    expect(categories._pendingPolicyWrites).toBe(0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    update.mockRestore();
  }
});
test('views detach source/default aliases and track edits without a setter dirty flag', () => {
  const input = [{ id: 'view', name: 'Saved', elements: [] }];
  const views = useViewsStore();
  views.loadViews(input);
  expect(views.hasPolicyDraft).toBe(false);
  views.views[0].name = 'Draft';
  expect(input[0].name).toBe('Saved');
  expect(views.hasPolicyDraft).toBe(true);
});
test('view save waits for real ACK without discarding later edits and failed save preserves baseline', async () => {
  const settings = useSettingsStore(),
    views = useViewsStore();
  views.loadViews([{ id: 'view', name: 'Saved', elements: [] }]);
  views.views[0].name = 'First';
  const pending = deferred();
  const update = jest.spyOn(settings, 'update').mockReturnValue(pending.promise);
  const saving = views.save();
  expect(views._pendingPolicyWrites).toBeGreaterThan(0);
  views.views[0].name = 'Later';
  expect(update.mock.calls[0][0].views[0].name).toBe('First');
  pending.resolve();
  await saving;
  expect(views.views[0].name).toBe('Later');
  expect(views.hasPolicyDraft).toBe(true);
  expect(views._pendingPolicyWrites).toBe(0);
  update.mockRejectedValueOnce(new Error('save failed'));
  await expect(views.save()).rejects.toThrow('save failed');
  expect(views.hasPolicyDraft).toBe(true);
  expect(views._pendingPolicyWrites).toBe(0);
});

test('clearing categories while persistence waits keeps its pending guard until ACK', async () => {
  const settings = useSettingsStore(),
    categories = useCategoryStore();
  categories.load([{ name: ['Work'], rule: { type: 'none' } }]);
  const pending = deferred();
  const update = jest.spyOn(settings, 'update').mockReturnValue(pending.promise);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const saving = categories.save();
    categories.clearAll();
    expect(categories._pendingPolicyWrites).toBeGreaterThan(0);
    pending.resolve();
    await saving;
    expect(categories._pendingPolicyWrites).toBe(0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    update.mockRestore();
  }
});
