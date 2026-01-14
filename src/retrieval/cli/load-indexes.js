import fs from 'node:fs';
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
import { MAX_JSON_BYTES, readJsonFile } from '../../shared/artifact-io.js';
import { resolveLanceDbPaths, resolveLanceDbTarget } from '../../shared/lancedb.js';

const EMPTY_INDEX = { chunkMeta: [], denseVec: null, minhash: null };

export async function loadSearchIndexes({
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
  lancedbConfig,
  loadIndexFromSqlite,
  loadIndexFromLmdb,
  resolvedDenseVectorMode
}) {
  const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
  const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;

  const proseIndexDir = runProse ? resolveIndexDir(rootDir, 'prose', userConfig) : null;
  const codeIndexDir = runCode ? resolveIndexDir(rootDir, 'code', userConfig) : null;
  const proseDir = runProse && !useSqlite
    ? requireIndexDir(rootDir, 'prose', userConfig, { emitOutput, exitOnError })
    : proseIndexDir;
  const codeDir = runCode && !useSqlite
    ? requireIndexDir(rootDir, 'code', userConfig, { emitOutput, exitOnError })
    : codeIndexDir;
  const recordsDir = runRecords
    ? requireIndexDir(rootDir, 'records', userConfig, { emitOutput, exitOnError })
    : null;

  const loadIndexCachedLocal = async (dir, includeHnsw = true) => loadIndexCached({
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
    if (searchMode === 'extracted-prose' || searchMode === 'default') {
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
    }) : await loadIndexCachedLocal(proseDir, annActive)))
    : { ...EMPTY_INDEX };
  const idxExtractedProse = resolvedRunExtractedProse
    ? await loadIndexCachedLocal(extractedProseDir, annActive)
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
    }) : await loadIndexCachedLocal(codeDir, annActive)))
    : { ...EMPTY_INDEX };
  const idxRecords = runRecords
    ? await loadIndexCachedLocal(recordsDir, annActive)
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
    idxCode.indexDir = codeIndexDir;
    if ((useSqlite || useLmdb) && !idxCode.fileRelations) {
      idxCode.fileRelations = loadFileRelations(rootDir, userConfig, 'code');
    }
    if ((useSqlite || useLmdb) && !idxCode.repoMap) {
      idxCode.repoMap = loadRepoMap(rootDir, userConfig, 'code');
    }
  }
  if (runProse) {
    idxProse.denseVec = resolveDenseVector(idxProse, 'prose', resolvedDenseVectorMode);
    idxProse.indexDir = proseIndexDir;
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
    idxExtractedProse.indexDir = extractedProseDir;
    if (!idxExtractedProse.fileRelations) {
      idxExtractedProse.fileRelations = loadFileRelations(rootDir, userConfig, 'extracted-prose');
    }
    if (!idxExtractedProse.repoMap) {
      idxExtractedProse.repoMap = loadRepoMap(rootDir, userConfig, 'extracted-prose');
    }
  }

  if (runRecords) {
    idxRecords.indexDir = recordsDir;
  }

  const attachLanceDb = (idx, mode, dir) => {
    if (!idx || !dir || lancedbConfig?.enabled === false) return null;
    const paths = resolveLanceDbPaths(dir);
    const target = resolveLanceDbTarget(mode, resolvedDenseVectorMode);
    const metaPath = paths?.[target]?.metaPath;
    const lanceDir = paths?.[target]?.dir;
    let meta = null;
    if (metaPath && fs.existsSync(metaPath)) {
      try {
        meta = readJsonFile(metaPath, { maxBytes: MAX_JSON_BYTES });
      } catch {}
    }
    const available = Boolean(meta && lanceDir && fs.existsSync(lanceDir));
    idx.lancedb = {
      target,
      dir: lanceDir || null,
      metaPath: metaPath || null,
      meta,
      available
    };
    return idx.lancedb;
  };

  attachLanceDb(idxCode, 'code', codeIndexDir);
  attachLanceDb(idxProse, 'prose', proseIndexDir);
  attachLanceDb(idxExtractedProse, 'extracted-prose', extractedProseDir);

  const lanceAnnState = {
    code: {
      available: Boolean(idxCode?.lancedb?.available),
      dims: idxCode?.lancedb?.meta?.dims ?? null,
      metric: idxCode?.lancedb?.meta?.metric ?? null
    },
    prose: {
      available: Boolean(idxProse?.lancedb?.available),
      dims: idxProse?.lancedb?.meta?.dims ?? null,
      metric: idxProse?.lancedb?.meta?.metric ?? null
    },
    records: { available: false, dims: null, metric: null },
    'extracted-prose': {
      available: Boolean(idxExtractedProse?.lancedb?.available),
      dims: idxExtractedProse?.lancedb?.meta?.dims ?? null,
      metric: idxExtractedProse?.lancedb?.meta?.metric ?? null
    }
  };
  const lanceAnnUsed = {
    code: false,
    prose: false,
    records: false,
    'extracted-prose': false
  };

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
    lanceAnnState,
    lanceAnnUsed,
    modelIdForCode,
    modelIdForProse,
    modelIdForExtractedProse,
    modelIdForRecords
  };
}
