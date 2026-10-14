import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Builder from '~/views/settings/CategoryBuilder.vue';
import ActivityView from '~/views/activity/ActivityView.vue';
import { useSettingsStore } from '~/stores/settings';
import { useCategoryStore } from '~/stores/categories';
import { useViewsStore } from '~/stores/views';
import { useBucketsStore } from '~/stores/buckets';
import { clearPolicyDrafts, hasPolicyDrafts, reloadPolicyDrafts } from '~/util/policyDrafts';
let wrappers = [];
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
beforeEach(() => {
  setActivePinia(createPinia());
  clearPolicyDrafts();
  useSettingsStore()._loaded = true;
  jest.spyOn(useSettingsStore(), 'ensureLoaded').mockResolvedValue();
  jest.spyOn(useBucketsStore(), 'ensureLoaded').mockResolvedValue();
  jest.spyOn(Builder.methods, 'fetchWords').mockResolvedValue();
});
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.destroy());
  wrappers = [];
  clearPolicyDrafts();
  jest.restoreAllMocks();
});
test('category builder open create and append drafts block, while clean ignored-word reload does no query', async () => {
  const wrapper = shallowMount(Builder);
  wrappers.push(wrapper);
  await flush();
  expect(hasPolicyDrafts()).toBe(false);
  wrapper.vm.create.categoryId = 0;
  expect(hasPolicyDrafts()).toBe(true);
  wrapper.vm.create.categoryId = null;
  await wrapper.setData({ appendOpen: true });
  expect(hasPolicyDrafts()).toBe(true);
  await wrapper.setData({ appendOpen: false });
  wrapper.vm.append.word = 'closed dialog value';
  expect(hasPolicyDrafts()).toBe(false);
  useSettingsStore().ignoredCategorySuggestions = ['Native'];
  const query = jest.spyOn(wrapper.vm, 'fetchWords');
  query.mockClear();
  expect(await reloadPolicyDrafts('settings.ignoredCategorySuggestions', async () => true)).toBe(
    true
  );
  expect(wrapper.vm.ignored_words).toEqual(['Native']);
  expect(query).not.toHaveBeenCalled();
});
test('activity view editing remains guarded even before a view mutation and unregisters', async () => {
  useViewsStore().loadViews([{ id: 'view', name: 'View', elements: [] }]);
  const wrapper = shallowMount(ActivityView, { propsData: { view_id: 'view' } });
  wrappers.push(wrapper);
  await flush();
  expect(hasPolicyDrafts()).toBe(false);
  await wrapper.setData({ editing: true });
  expect(hasPolicyDrafts()).toBe(true);
  wrapper.destroy();
  expect(hasPolicyDrafts()).toBe(false);
});
