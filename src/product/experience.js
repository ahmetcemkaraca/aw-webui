const VISIBLE_STATUSES = new Set(['Available', 'Beta', 'Experimental']);

export function capability(id, contract) {
  return Array.isArray(contract?.capabilities)
    ? contract.capabilities.find(item => item.id === id)
    : undefined;
}

export function isShipped(id, contract) {
  return VISIBLE_STATUSES.has(capability(id, contract)?.status);
}

export function statusLabel(id, contract) {
  const status = capability(id, contract)?.status;
  return status && status !== 'Available' ? status : '';
}
