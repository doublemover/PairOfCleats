export const formatWorkspacePartitionList = (partitions, { limit = 4 } = {}) => (
  (Array.isArray(partitions) ? partitions : [])
    .map((entry) => String(entry?.rootRel || '.'))
    .filter(Boolean)
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)))
    .join(', ')
);

export const toWorkspacePartitionScopedCheck = (check, partition) => {
  if (!check || typeof check !== 'object') return null;
  const rootRel = String(partition?.rootRel || '.').trim() || '.';
  const message = String(check.message || '').trim();
  return {
    ...check,
    message: message ? `${message} [partition=${rootRel}]` : `[partition=${rootRel}]`
  };
};
