export const SERVICE_SYNC_POLICIES = new Set(['pull', 'fetch', 'none']);

export const normalizeServiceSyncPolicy = value => (
  typeof value === 'string' ? value.trim().toLowerCase() : value
);
