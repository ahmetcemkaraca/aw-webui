import { createLocalVue, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SyncBackupCatalogue from '~/components/SyncBackupCatalogue.vue';
import { useBackupStore } from '~/stores/backups';
const localVue = createLocalVue();
let wrapper;
beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  jest.restoreAllMocks();
});
test('mount does not create snapshots or discover providers and local actions remain free', () => {
  const s = useBackupStore();
  const load = jest.spyOn(s, 'load').mockResolvedValue();
  const network = jest.spyOn(s, 'reviewProvider').mockResolvedValue();
  wrapper = mount(SyncBackupCatalogue, { localVue });
  expect(load).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(wrapper.find('[data-backup-list]').attributes('disabled')).toBeUndefined();
  expect(wrapper.text()).toContain('Local browsing and export are free');
});
test('inactive screen clears secrets and disables local and provider actions', async () => {
  const s = useBackupStore();
  s.configure({ mode: 'folder', folderPath: '/private', kitRaw: '{}', phrase: 'private' });
  wrapper = mount(SyncBackupCatalogue, { localVue });
  await wrapper.setProps({ active: false });
  expect(s.phrase).toBe('');
  expect(s.kitRaw).toBe('');
  expect(wrapper.find('[data-backup-list]').attributes('disabled')).toBeDefined();
  expect(wrapper.find('[data-backup-provider]').attributes('disabled')).toBeDefined();
});
test('selection is unavailable for incomplete rows and verified dates are labelled as payload range', () => {
  const s = useBackupStore();
  s.versions = [
    {
      snapshot_id: 'fixture',
      status: 'incomplete',
      selection: null,
      event_count: null,
      query_start: null,
      query_end: null,
      object_count: 1,
      key_epoch: '1',
    },
  ];
  wrapper = mount(SyncBackupCatalogue, { localVue });
  expect(wrapper.find('[data-backup-select]').attributes('disabled')).toBeDefined();
  expect(wrapper.text()).toContain('Incomplete');
  expect(wrapper.text()).not.toContain('Newest');
});

test('historical deletion requires its own checkbox and current version stays protected', async () => {
  const s = useBackupStore();
  s.deletePreview = { object_count: 1, copy_scope: 'local', retry: false };
  s.versions = [
    {
      snapshot_id: 'fixture',
      status: 'forgotten',
      current: true,
      object_count: 1,
      key_epoch: '1',
      selection: null,
      deletion_selection: null,
    },
  ];
  const remove = jest.spyOn(s, 'deleteSelected').mockResolvedValue();
  wrapper = mount(SyncBackupCatalogue, { localVue });
  expect(wrapper.find('[data-backup-delete]').attributes('disabled')).toBeDefined();
  expect(wrapper.find('[data-backup-delete-select]').attributes('disabled')).toBeDefined();
  expect(wrapper.text()).toContain('Current snapshot');
  await wrapper.find('input[type="checkbox"]').setChecked(true);
  await wrapper.find('[data-backup-delete]').trigger('click');
  expect(remove).toHaveBeenCalledWith(true);
  await wrapper.setProps({ active: false });
  expect(s.deletePreview).toBeNull();
});
