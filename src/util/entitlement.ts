const SHIPPED_CAPABILITY_STATES = new Set(['Available', 'Beta', 'Experimental']);

export interface NativeEntitlementStatusV1 {
  plan_id: string;
  feature_ids: string[];
  access: 'current' | 'grace';
}

export function hasFeatureEntitlement(
  capabilityStatus: string | undefined,
  entitlement: unknown,
  featureId: string,
): boolean {
  if (!capabilityStatus || !SHIPPED_CAPABILITY_STATES.has(capabilityStatus)
      || !entitlement || typeof entitlement !== 'object') return false;
  const status = entitlement as Partial<NativeEntitlementStatusV1>;
  return (status.access === 'current' || status.access === 'grace')
    && Array.isArray(status.feature_ids)
    && status.feature_ids.every(id => typeof id === 'string')
    && status.feature_ids.includes(featureId);
}

export async function loadNativeEntitlementStatus(): Promise<NativeEntitlementStatusV1 | null> {
  const bridge = (window as unknown as {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
  }).__TAURI__;
  if (!bridge) return null;
  try {
    const status = await bridge.core.invoke('load_entitlement_status');
    return status && typeof status === 'object'
      ? status as NativeEntitlementStatusV1
      : null;
  } catch (_) {
    return null;
  }
}
