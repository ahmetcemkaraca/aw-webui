import { defineStore, setActivePinia } from 'pinia';
import pinia from '~/stores';
import { clearDecryptedState } from '~/stores/clearDecryptedState';

test('clears held sensitive references before disposal while preserving vault and legacy stores', () => {
  setActivePinia(pinia);
  const events: string[] = [];
  const useSensitive = defineStore('sensitive-cleanup-test', {
    state: () => ({ secret: 'private history' }),
    actions: {
      clearSensitive() { this.secret = ''; events.push('clear'); },
    },
  });
  const sensitive = useSensitive();
  const originalDispose = sensitive.$dispose;
  sensitive.$dispose = () => { events.push(`dispose:${sensitive.secret}`); originalDispose(); };
  const legacy = defineStore('legacy-cleanup-test', { state: () => ({ value: 1 }) })();
  const vault = defineStore('vault', { state: () => ({ state: 'ready' }) })();
  const vaultDispose = jest.spyOn(vault, '$dispose');

  clearDecryptedState();

  expect(events).toEqual(['clear', 'dispose:']);
  expect(sensitive.secret).toBe('');
  expect(pinia.state.value[sensitive.$id]).toBeUndefined();
  expect(pinia.state.value[legacy.$id]).toBeUndefined();
  expect(pinia.state.value.vault).toEqual({ state: 'ready' });
  expect(vaultDispose).not.toHaveBeenCalled();
  vault.$dispose();
  delete pinia.state.value.vault;
});

import { useReportStore } from '~/stores/reports';
import { reportCompleted,reportLibrary } from '../fixtures/reports';
test('generic vault cleanup clears the actual managed report store and held artifacts',()=>{
  setActivePinia(pinia);
  const reports=useReportStore();reports.library=reportLibrary() as any;reports.lastCompleted=reportCompleted() as any;reports.runId='a'.repeat(32);reports.capability='b'.repeat(64);reports.phase='running';
  const held=reports.lastCompleted;expect(held).not.toBeNull();clearDecryptedState();
  expect(reports.library).toBeNull();expect(reports.lastCompleted).toBeNull();expect(reports.capability).toBeNull();expect(reports.rawEvents).toBeNull();expect(pinia.state.value.reports).toBeUndefined();
});

import { registerPolicyDraft,hasPolicyDrafts,clearPolicyDrafts } from '~/util/policyDrafts';
import { useSyncPolicyStore } from '~/stores/syncPolicies';
import { parsePolicyPreview } from '~/util/policyContracts';
import { policyPreview } from '../fixtures/policies';
test('actual vault cleanup clears held policy values and component draft registrations',()=>{
 setActivePinia(pinia);clearPolicyDrafts();const policies=useSyncPolicyStore();policies.preview=parsePolicyPreview(JSON.stringify(policyPreview()));
 registerPolicyDraft(['settings.theme'],{blocked:()=>true});expect(hasPolicyDrafts()).toBe(true);clearDecryptedState();
 expect(policies.preview).toBeNull();expect(policies.candidates).toEqual([]);expect(hasPolicyDrafts()).toBe(false);expect(pinia.state.value['sync-policies']).toBeUndefined();
});
