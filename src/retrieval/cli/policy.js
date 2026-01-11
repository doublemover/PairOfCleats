import { getIndexDir } from '../../../tools/dict-utils.js';
import { resolveBackendPolicy } from '../../storage/backend-policy.js';
import { getSqliteChunkCount } from '../cli-sqlite.js';
import { estimateIndexBytes } from './options.js';

export const resolveBackendSelection = async ({
  backendArg,
  sqliteScoreModeConfig,
  sqliteConfigured,
  sqliteAvailable,
  sqliteCodeAvailable,
  sqliteProseAvailable,
  sqliteCodePath,
  sqliteProsePath,
  lmdbConfigured,
  lmdbAvailable,
  lmdbCodeAvailable,
  lmdbProseAvailable,
  lmdbCodePath,
  lmdbProsePath,
  sqliteAutoChunkThreshold,
  sqliteAutoArtifactBytes,
  needsSqlite,
  needsCode,
  needsProse,
  root,
  userConfig,
  onWarn
}) => {
  let chunkCounts = [];
  let artifactBytes = [];
  if (needsSqlite && (!backendArg || backendArg === 'auto')) {
    if (sqliteAutoChunkThreshold > 0) {
      if (needsCode) chunkCounts.push(await getSqliteChunkCount(sqliteCodePath, 'code'));
      if (needsProse) chunkCounts.push(await getSqliteChunkCount(sqliteProsePath, 'prose'));
    }
    if (sqliteAutoArtifactBytes > 0) {
      if (needsCode) artifactBytes.push(estimateIndexBytes(getIndexDir(root, 'code', userConfig)));
      if (needsProse) artifactBytes.push(estimateIndexBytes(getIndexDir(root, 'prose', userConfig)));
    }
  }

  const backendPolicy = resolveBackendPolicy({
    backendArg,
    sqliteScoreModeConfig,
    sqliteConfigured,
    sqliteAvailable,
    lmdbConfigured,
    lmdbAvailable,
    sqliteAutoChunkThreshold,
    sqliteAutoArtifactBytes,
    needsSqlite,
    chunkCounts,
    artifactBytes
  });

  if (backendPolicy.error) {
    const missing = [];
    if (backendPolicy.backendLabel === 'lmdb') {
      if (needsCode && !lmdbCodeAvailable) missing.push(`code=${lmdbCodePath}`);
      if (needsProse && !lmdbProseAvailable) missing.push(`prose=${lmdbProsePath}`);
    } else {
      if (needsCode && !sqliteCodeAvailable) missing.push(`code=${sqliteCodePath}`);
      if (needsProse && !sqliteProseAvailable) missing.push(`prose=${sqliteProsePath}`);
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
  if (backendPolicy.backendDisabled) {
    onWarn?.(`Unknown backend "${backendArg}". Falling back to memory.`);
  }

  let useSqlite = backendPolicy.useSqlite;
  let useLmdb = backendPolicy.useLmdb;
  if (useLmdb) {
    useSqlite = false;
  }

  return {
    backendPolicy,
    useSqlite,
    useLmdb,
    sqliteFtsRequested: backendPolicy.sqliteFtsRequested,
    backendForcedSqlite: backendPolicy.backendForcedSqlite,
    backendForcedLmdb: backendPolicy.backendForcedLmdb
  };
};
