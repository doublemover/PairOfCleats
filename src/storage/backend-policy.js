export function resolveBackendPolicy({
  backendArg,
  sqliteScoreModeConfig = false,
  sqliteConfigured = true,
  sqliteAvailable = false,
  sqliteAutoChunkThreshold = 0,
  sqliteAutoArtifactBytes = 0,
  needsSqlite = true,
  chunkCounts = [],
  artifactBytes = []
} = {}) {
  const normalized = typeof backendArg === 'string' ? backendArg.toLowerCase() : '';
  const backendAuto = !normalized || normalized === 'auto';
  const sqliteFtsRequested = normalized === 'sqlite-fts'
    || normalized === 'fts'
    || (backendAuto && sqliteScoreModeConfig === true);
  const backendForcedSqlite = normalized === 'sqlite' || sqliteFtsRequested;
  const backendForcedMemory = normalized === 'memory';
  const backendDisabled = normalized
    && !backendAuto
    && !backendForcedSqlite
    && !backendForcedMemory;

  const counts = Array.isArray(chunkCounts)
    ? chunkCounts.filter((count) => Number.isFinite(count))
    : [];
  const maxChunkCount = counts.length ? Math.max(...counts) : null;
  const byteTotals = Array.isArray(artifactBytes)
    ? artifactBytes.filter((count) => Number.isFinite(count))
    : [];
  const totalArtifactBytes = byteTotals.length
    ? byteTotals.reduce((sum, next) => sum + next, 0)
    : null;

  const policy = {
    requested: normalized || 'auto',
    sqliteAutoChunkThreshold,
    sqliteAutoArtifactBytes,
    maxChunkCount,
    totalArtifactBytes
  };

  if (backendDisabled) {
    return {
      useSqlite: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedMemory: false,
      backendDisabled: true,
      reason: 'unknown backend requested',
      policy
    };
  }

  if (!needsSqlite) {
    return {
      useSqlite: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedMemory,
      backendDisabled: false,
      reason: 'no sqlite needed for selected mode',
      policy
    };
  }

  if (backendForcedSqlite && !sqliteAvailable) {
    return {
      useSqlite: false,
      backendLabel: sqliteFtsRequested ? 'sqlite-fts' : 'sqlite',
      sqliteFtsRequested,
      backendForcedSqlite,
      backendForcedMemory,
      backendDisabled: false,
      reason: 'sqlite indexes missing',
      error: 'SQLite backend requested but index not found',
      policy
    };
  }

  if (backendForcedSqlite) {
    return {
      useSqlite: true,
      backendLabel: sqliteFtsRequested ? 'sqlite-fts' : 'sqlite',
      sqliteFtsRequested,
      backendForcedSqlite,
      backendForcedMemory,
      backendDisabled: false,
      reason: 'sqlite backend forced by flag',
      policy
    };
  }

  if (backendForcedMemory) {
    return {
      useSqlite: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedMemory: true,
      backendDisabled: false,
      reason: 'memory backend forced by flag',
      policy
    };
  }

  if (!sqliteConfigured || !sqliteAvailable) {
    return {
      useSqlite: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedMemory: false,
      backendDisabled: false,
      reason: sqliteConfigured ? 'sqlite indexes unavailable' : 'sqlite disabled',
      policy
    };
  }

  let autoUseSqlite = true;
  let autoReason = 'auto default';
  const thresholdsEnabled = sqliteAutoChunkThreshold > 0 || sqliteAutoArtifactBytes > 0;
  if (thresholdsEnabled) {
    const hits = [];
    if (sqliteAutoChunkThreshold > 0 && Number.isFinite(maxChunkCount)) {
      hits.push(maxChunkCount >= sqliteAutoChunkThreshold ? 'chunkCount' : null);
    }
    if (sqliteAutoArtifactBytes > 0 && Number.isFinite(totalArtifactBytes)) {
      hits.push(totalArtifactBytes >= sqliteAutoArtifactBytes ? 'artifactBytes' : null);
    }
    const hitReasons = hits.filter(Boolean);
    if (hitReasons.length) {
      autoUseSqlite = true;
      autoReason = `auto threshold met (${hitReasons.join(', ')})`;
    } else if (hits.length) {
      autoUseSqlite = false;
      autoReason = 'auto threshold not met';
    }
  }

  return {
    useSqlite: autoUseSqlite,
    backendLabel: autoUseSqlite ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite') : 'memory',
    sqliteFtsRequested,
    backendForcedSqlite: false,
    backendForcedMemory: false,
    backendDisabled: false,
    reason: autoReason,
    policy
  };
}
