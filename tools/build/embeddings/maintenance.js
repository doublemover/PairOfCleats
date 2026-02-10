const MB = 1024 * 1024;

const toFiniteNonNegative = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

export function normalizeEmbeddingsMaintenanceConfig(raw = {}) {
  const maintenance = raw && typeof raw === 'object' ? raw : {};
  return {
    background: maintenance.background === true,
    sqliteWalMaxBytes: toFiniteNonNegative(maintenance.sqliteWalMaxBytes, 128 * MB),
    sqliteMinDbBytes: toFiniteNonNegative(maintenance.sqliteMinDbBytes, 512 * MB),
    sqliteMinDenseCount: Math.floor(toFiniteNonNegative(maintenance.sqliteMinDenseCount, 100000))
  };
}

export function shouldQueueSqliteMaintenance({
  config,
  dbBytes,
  walBytes,
  denseCount
}) {
  const normalized = normalizeEmbeddingsMaintenanceConfig(config);
  if (!normalized.background) {
    return { queue: false, reason: 'disabled' };
  }
  const resolvedDbBytes = toFiniteNonNegative(dbBytes, 0);
  const resolvedWalBytes = toFiniteNonNegative(walBytes, 0);
  const resolvedDenseCount = Math.floor(toFiniteNonNegative(denseCount, 0));

  if (normalized.sqliteWalMaxBytes > 0 && resolvedWalBytes >= normalized.sqliteWalMaxBytes) {
    return { queue: true, reason: 'wal-threshold' };
  }

  if (
    normalized.sqliteMinDbBytes > 0
    && resolvedDbBytes >= normalized.sqliteMinDbBytes
    && normalized.sqliteMinDenseCount > 0
    && resolvedDenseCount >= normalized.sqliteMinDenseCount
  ) {
    return { queue: true, reason: 'db-and-dense-threshold' };
  }

  return { queue: false, reason: 'below-threshold' };
}
