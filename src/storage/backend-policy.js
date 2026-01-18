export function resolveBackendPolicy({
  backendArg,
  sqliteAvailable = false,
  lmdbAvailable = false,
  needsSqlite = true,
  defaultBackend = 'sqlite'
} = {}) {
  const normalized = typeof backendArg === 'string' ? backendArg.toLowerCase() : '';
  const backendAuto = !normalized || normalized === 'auto';
  const sqliteFtsRequested = normalized === 'sqlite-fts' || normalized === 'fts';
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

  const policy = {
    requested: normalized || 'auto',
    defaultBackend,
    sqliteAvailable,
    lmdbAvailable
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

  const prefersLmdb = defaultBackend === 'lmdb';
  let autoUseSqlite = !prefersLmdb;
  let autoUseLmdb = prefersLmdb;
  let autoReason = prefersLmdb ? 'auto default (lmdb)' : 'auto default (sqlite)';
  if (!sqliteAvailable && lmdbAvailable) {
    autoUseSqlite = false;
    autoUseLmdb = true;
    autoReason = 'sqlite unavailable; using lmdb';
  } else if (!sqliteAvailable && !lmdbAvailable) {
    autoUseSqlite = false;
    autoUseLmdb = false;
    autoReason = 'sqlite unavailable';
  } else if (prefersLmdb && !lmdbAvailable) {
    autoUseSqlite = true;
    autoUseLmdb = false;
    autoReason = 'lmdb unavailable; using sqlite';
  }

  return {
    useSqlite: autoUseSqlite,
    useLmdb: autoUseLmdb,
    backendLabel: autoUseSqlite
      ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite')
      : (autoUseLmdb ? 'lmdb' : 'memory'),
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
