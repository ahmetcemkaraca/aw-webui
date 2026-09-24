import pinia from '~/stores';

export function clearDecryptedState() {
  const stores = pinia as typeof pinia & { _s: Map<string, { $id: string; $dispose: () => void }> };
  const state = pinia.state.value as Record<string, unknown>;
  for (const store of stores._s.values()) {
    if (store.$id === 'vault') continue;
    store.$dispose();
    delete state[store.$id];
  }
}
