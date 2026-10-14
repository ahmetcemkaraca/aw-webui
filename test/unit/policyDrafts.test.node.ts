import {
  registerPolicyDraft,
  hasPolicyDrafts,
  reloadPolicyDrafts,
  clearPolicyDrafts,
} from '~/util/policyDrafts';
afterEach(() => clearPolicyDrafts());
test('reads live hidden editor and pending-save guards without storing draft contents', () => {
  let dirty = false;
  const release = registerPolicyDraft(['settings.theme'], { blocked: () => dirty });
  expect(hasPolicyDrafts()).toBe(false);
  dirty = true;
  expect(hasPolicyDrafts()).toBe(true);
  release();
  expect(hasPolicyDrafts()).toBe(false);
});
test('guard failures fail closed and cleanup removes held editor registrations', () => {
  registerPolicyDraft(['settings.theme'], {
    blocked: () => {
      throw new Error('private draft');
    },
  });
  expect(hasPolicyDrafts()).toBe(true);
  clearPolicyDrafts();
  expect(hasPolicyDrafts()).toBe(false);
});
test('reloads only the acknowledged field and its native companion groups', async () => {
  const categories = jest.fn(),
    other = jest.fn(),
    egress = jest.fn();
  registerPolicyDraft(['settings.category_sets'], { blocked: () => false, reload: categories });
  registerPolicyDraft(['settings.theme'], { blocked: () => false, reload: other });
  registerPolicyDraft(['egress.user_policy'], { blocked: () => false, reload: egress });
  expect(await reloadPolicyDrafts('settings.classes', async () => true)).toBe(true);
  expect(categories).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  expect(await reloadPolicyDrafts('egress.signed_bundle', async () => true)).toBe(true);
  expect(egress).toHaveBeenCalledTimes(1);
});
test('drafts and failed lifetime checks prevent reload callbacks', async () => {
  const reload = jest.fn();
  registerPolicyDraft(['settings.theme'], { blocked: () => true, reload });
  expect(await reloadPolicyDrafts('settings.theme', async () => true)).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  clearPolicyDrafts();
  registerPolicyDraft(['settings.theme'], { blocked: () => false, reload });
  expect(await reloadPolicyDrafts('settings.theme', async () => false)).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
test('rechecks guards after awaiting ownership and stops if editing begins', async () => {
  let dirty = false;
  const reload = jest.fn();
  registerPolicyDraft(['settings.theme'], { blocked: () => dirty, reload });
  expect(
    await reloadPolicyDrafts('settings.theme', async () => {
      dirty = true;
      return true;
    })
  ).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
test('a changed lifetime while a callback waits suppresses later callbacks', async () => {
  let current = true;
  const later = jest.fn();
  registerPolicyDraft(['settings.theme'], {
    blocked: () => false,
    reload: async () => {
      current = false;
    },
  });
  registerPolicyDraft(['settings.theme'], { blocked: () => false, reload: later });
  expect(await reloadPolicyDrafts('settings.theme', async () => current)).toBe(false);
  expect(later).not.toHaveBeenCalled();
});
test('cleared registry invalidates the ownership guard held by an awaited callback', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  let applied = false;
  registerPolicyDraft(['settings.theme'], {
    blocked: () => false,
    reload: async owned => {
      await wait;
      if (await owned()) applied = true;
    },
  });
  const reload = reloadPolicyDrafts('settings.theme', async () => true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  clearPolicyDrafts();
  release();
  expect(await reload).toBe(false);
  expect(applied).toBe(false);
});
