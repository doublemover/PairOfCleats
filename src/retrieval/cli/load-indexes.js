import {
  hasIndexMeta,
  loadFileRelations,
  loadIndexCached,
  loadRepoMap,
  resolveDenseVector,
  warnPendingState
} from './index-loader.js';
import { loadIndex, requireIndexDir, resolveIndexDir } from '../cli-index.js';
import { resolveModelIds } from './model-ids.js';

const EMPTY_INDEX = { chunkMeta: [], denseVec: null, minhash: null };

export function loadSearchIndexes({
  rootDir,
  userConfig,
  searchMode,
  runProse,
  runExtractedProse,
  runCode,
  runRecords,
  useSqlite,
  useLmdb,
  emitOutput,
  exitOnError,
  annActive,
  filtersActive,
  contextExpansionEnabled,
  sqliteFtsRequested,
  indexCache,
  modelIdDefault,
  fileChargramN,
  hnswConfig,
  loadIndexFromSqlite,
  loadIndexFromLmdb,
  resolvedDenseVectorMode
}) {
  const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
  const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;

  const proseDir = runProse && !useSqlite
    ? requireIndexDir(rootDir, 'prose', userConfig, { emitOutput, exitOnError })
    : null;
  const codeDir = runCode && !useSqlite
    ? requireIndexDir(rootDir, 'code', userConfig, { emitOutput, exitOnError })
    : null;
  const recordsDir = runRecords
    ? requireIndexDir(rootDir, 'records', userConfig, { emitOutput, exitOnError })
    : null;

  const loadIndexCachedLocal = (dir, includeHnsw = true) => loadIndexCached({
    indexCache,
    dir,
    modelIdDefault,
    fileChargramN,
    includeHnsw,
    hnswConfig,
    loadIndex
  });

  let extractedProseDir = null;
  let resolvedRunExtractedProse = runExtractedProse;
  if (resolvedRunExtractedProse) {
    if (searchMode === 'extracted-prose') {
      extractedProseDir = requireIndexDir(rootDir, 'extracted-prose', userConfig, { emitOutput, exitOnError });
    } else {
      extractedProseDir = resolveIndexDir(rootDir, 'extracted-prose', userConfig);
      if (!hasIndexMeta(extractedProseDir)) {
        resolvedRunExtractedProse = false;
        if (emitOutput) {
          console.warn('[search] extracted-prose index not found; skipping.');
        }
      }
    }
  }

  const idxProse = runProse
    ? (useSqlite ? loadIndexFromSqlite('prose', {
      includeDense: annActive,
      includeMinhash: annActive,
      includeChunks: sqliteContextChunks,
      includeFilterIndex: filtersActive
    }) : (useLmdb ? loadIndexFromLmdb('prose', {
      includeDense: annActive,
      includeMinhash: annActive,
      includeChunks: true,
      includeFilterIndex: filtersActive
    }) : loadIndexCachedLocal(proseDir, annActive)))
    : { ...EMPTY_INDEX };
  const idxExtractedProse = resolvedRunExtractedProse
    ? loadIndexCachedLocal(extractedProseDir, annActive)
    : { ...EMPTY_INDEX };
  const idxCode = runCode
    ? (useSqlite ? loadIndexFromSqlite('code', {
      includeDense: annActive,
      includeMinhash: annActive,
      includeChunks: sqliteContextChunks,
      includeFilterIndex: filtersActive
    }) : (useLmdb ? loadIndexFromLmdb('code', {
      includeDense: annActive,
      includeMinhash: annActive,
      includeChunks: true,
      includeFilterIndex: filtersActive
    }) : loadIndexCachedLocal(codeDir, annActive)))
    : { ...EMPTY_INDEX };
  const idxRecords = runRecords
    ? loadIndexCachedLocal(recordsDir, annActive)
    : { ...EMPTY_INDEX };

  warnPendingState(idxCode, 'code', { emitOutput, useSqlite, annActive });
  warnPendingState(idxProse, 'prose', { emitOutput, useSqlite, annActive });
  warnPendingState(idxExtractedProse, 'extracted-prose', { emitOutput, useSqlite, annActive });

  const hnswAnnState = {
    code: { available: Boolean(idxCode?.hnsw?.available) },
    prose: { available: Boolean(idxProse?.hnsw?.available) },
    records: { available: Boolean(idxRecords?.hnsw?.available) },
    'extracted-prose': { available: Boolean(idxExtractedProse?.hnsw?.available) }
  };
  const hnswAnnUsed = {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  };

  if (runCode) {
    idxCode.denseVec = resolveDenseVector(idxCode, 'code', resolvedDenseVectorMode);
    if ((useSqlite || useLmdb) && !idxCode.fileRelations) {
      idxCode.fileRelations = loadFileRelations(rootDir, userConfig, 'code');
    }
    if ((useSqlite || useLmdb) && !idxCode.repoMap) {
      idxCode.repoMap = loadRepoMap(rootDir, userConfig, 'code');
    }
  }
  if (runProse) {
    idxProse.denseVec = resolveDenseVector(idxProse, 'prose', resolvedDenseVectorMode);
    if ((useSqlite || useLmdb) && !idxProse.fileRelations) {
      idxProse.fileRelations = loadFileRelations(rootDir, userConfig, 'prose');
    }
    if ((useSqlite || useLmdb) && !idxProse.repoMap) {
      idxProse.repoMap = loadRepoMap(rootDir, userConfig, 'prose');
    }
  }
  if (resolvedRunExtractedProse) {
    idxExtractedProse.denseVec = resolveDenseVector(
      idxExtractedProse,
      'extracted-prose',
      resolvedDenseVectorMode
    );
    if (!idxExtractedProse.fileRelations) {
      idxExtractedProse.fileRelations = loadFileRelations(rootDir, userConfig, 'extracted-prose');
    }
    if (!idxExtractedProse.repoMap) {
      idxExtractedProse.repoMap = loadRepoMap(rootDir, userConfig, 'extracted-prose');
    }
  }

  const {
    modelIdForCode,
    modelIdForProse,
    modelIdForExtractedProse,
    modelIdForRecords
  } = resolveModelIds({
    modelIdDefault,
    runCode,
    runProse,
    runExtractedProse: resolvedRunExtractedProse,
    runRecords,
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords
  });

  return {
    idxProse,
    idxExtractedProse,
    idxCode,
    idxRecords,
    runExtractedProse: resolvedRunExtractedProse,
    hnswAnnState,
    hnswAnnUsed,
    modelIdForCode,
    modelIdForProse,
    modelIdForExtractedProse,
    modelIdForRecords
  };
}
