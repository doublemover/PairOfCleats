export function resolveBackendPolicy({
  backendArg,
  sqliteScoreModeConfig = false,
  sqliteConfigured = true,
  sqliteAvailable = false,
  lmdbConfigured = true,
  lmdbAvailable = false,
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
  const backendForcedLmdb = normalized === 'lmdb';
  const backendForcedMemory = normalized === 'memory';
  const backendForcedTantivy = normalized === 'tantivy';
  const backendDisabled = normalized
    && !backendAuto
    && !backendForcedSqlite
    && !backendForcedLmdb
    && !backendForcedMemory
    && !backendForcedTantivy;

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
    totalArtifactBytes,
    lmdbAvailable,
    lmdbConfigured
  };

  if (backendDisabled) {
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb: false,
      backendForcedMemory: false,
      backendForcedTantivy: false,
      backendDisabled: true,
      reason: 'unknown backend requested',
      policy
    };
  }

  if (!needsSqlite) {
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb,
      backendForcedMemory,
      backendForcedTantivy,
      backendDisabled: false,
      reason: 'no sqlite needed for selected mode',
      policy
    };
  }

  if (backendForcedTantivy) {
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: 'tantivy',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb: false,
      backendForcedMemory: false,
      backendForcedTantivy: true,
      backendDisabled: false,
      reason: 'tantivy backend forced by flag',
      policy
    };
  }

  if (backendForcedLmdb && !lmdbAvailable) {
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: 'lmdb',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb,
      backendForcedMemory,
      backendForcedTantivy,
      backendDisabled: false,
      reason: 'lmdb indexes missing',
      error: 'LMDB backend requested but index not found',
      policy
    };
  }

  if (backendForcedLmdb) {
    return {
      useSqlite: false,
      useLmdb: true,
      backendLabel: 'lmdb',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb,
      backendForcedMemory,
      backendForcedTantivy,
      backendDisabled: false,
      reason: 'lmdb backend forced by flag',
      policy
    };
  }

  if (backendForcedSqlite && !sqliteAvailable) {
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: sqliteFtsRequested ? 'sqlite-fts' : 'sqlite',
      sqliteFtsRequested,
      backendForcedSqlite,
      backendForcedLmdb,
      backendForcedMemory,
      backendForcedTantivy,
      backendDisabled: false,
      reason: 'sqlite indexes missing',
      error: 'SQLite backend requested but index not found',
      policy
    };
  }

  if (backendForcedSqlite) {
    return {
      useSqlite: true,
      useLmdb: false,
      backendLabel: sqliteFtsRequested ? 'sqlite-fts' : 'sqlite',
      sqliteFtsRequested,
      backendForcedSqlite,
      backendForcedLmdb,
      backendForcedMemory,
      backendForcedTantivy,
      backendDisabled: false,
      reason: 'sqlite backend forced by flag',
      policy
    };
  }

  if (backendForcedMemory) {
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb,
      backendForcedMemory: true,
      backendForcedTantivy,
      backendDisabled: false,
      reason: 'memory backend forced by flag',
      policy
    };
  }

  if (!sqliteConfigured || !sqliteAvailable) {
    if (lmdbConfigured && lmdbAvailable) {
      return {
        useSqlite: false,
        useLmdb: true,
        backendLabel: 'lmdb',
        sqliteFtsRequested: false,
        backendForcedSqlite: false,
        backendForcedLmdb: false,
        backendForcedMemory: false,
        backendForcedTantivy,
        backendDisabled: false,
        reason: sqliteConfigured ? 'sqlite indexes unavailable; using lmdb' : 'sqlite disabled; using lmdb',
        policy
      };
    }
    return {
      useSqlite: false,
      useLmdb: false,
      backendLabel: 'memory',
      sqliteFtsRequested: false,
      backendForcedSqlite: false,
      backendForcedLmdb,
      backendForcedMemory: false,
      backendForcedTantivy,
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
    useLmdb: false,
    backendLabel: autoUseSqlite ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite') : 'memory',
    sqliteFtsRequested,
    backendForcedSqlite: false,
    backendForcedLmdb: false,
    backendForcedMemory: false,
    backendForcedTantivy,
    backendDisabled: false,
    reason: autoReason,
    policy
  };
}
