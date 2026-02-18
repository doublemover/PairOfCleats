import { resolveBackendPolicy } from '../../storage/backend-policy.js';

export const resolveBackendSelection = async ({
  backendArg,
  sqliteAvailable,
  sqliteCodeAvailable,
  sqliteProseAvailable,
  sqliteExtractedProseAvailable,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  lmdbAvailable,
  lmdbCodeAvailable,
  lmdbProseAvailable,
  lmdbCodePath,
  lmdbProsePath,
  needsSqlite,
  needsCode,
  needsProse,
  needsExtractedProse,
  defaultBackend,
  onWarn
}) => {
  const backendPolicy = resolveBackendPolicy({
    backendArg,
    sqliteAvailable,
    lmdbAvailable,
    needsSqlite,
    defaultBackend
  });

  if (backendPolicy.error) {
    const missing = [];
    if (backendPolicy.backendLabel === 'lmdb') {
      if (needsCode && !lmdbCodeAvailable) missing.push(`code=${lmdbCodePath}`);
      if (needsProse && !lmdbProseAvailable) missing.push(`prose=${lmdbProsePath}`);
    } else {
      if (needsCode && !sqliteCodeAvailable) missing.push(`code=${sqliteCodePath}`);
      if (needsProse && !sqliteProseAvailable) missing.push(`prose=${sqliteProsePath}`);
      if (needsExtractedProse && !sqliteExtractedProseAvailable) {
        missing.push(`extracted-prose=${sqliteExtractedProsePath}`);
      }
    }
    const suffix = missing.length
      ? missing.join(', ')
      : (backendPolicy.backendLabel === 'lmdb' ? 'missing lmdb index' : 'missing sqlite index');
    return {
      backendPolicy,
      error: {
        message: `${backendPolicy.error} (${suffix}).`,
        missing
      }
    };
  }

  if (!needsSqlite && backendPolicy.backendForcedSqlite) {
    onWarn?.('SQLite backend requested, but records-only mode selected; using file-backed records index.');
  }
  if (!needsSqlite && backendPolicy.backendForcedLmdb) {
    onWarn?.('LMDB backend requested, but records-only mode selected; using file-backed records index.');
  }
  if (!needsSqlite && backendPolicy.backendForcedTantivy) {
    onWarn?.('Tantivy backend requested, but records-only mode selected; using file-backed records index.');
  }
  if (backendPolicy.backendDisabled) {
    onWarn?.(`Unknown backend "${backendArg}". Falling back to memory.`);
  }

  let useSqlite = backendPolicy.useSqlite;
  let useLmdb = backendPolicy.useLmdb;
  if (useLmdb) {
    useSqlite = false;
  }

  const backendForcedTantivy = backendPolicy.backendForcedTantivy && needsSqlite;
  return {
    backendPolicy,
    useSqlite,
    useLmdb,
    sqliteFtsRequested: backendPolicy.sqliteFtsRequested,
    backendForcedSqlite: backendPolicy.backendForcedSqlite,
    backendForcedLmdb: backendPolicy.backendForcedLmdb,
    backendForcedTantivy
  };
};
