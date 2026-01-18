import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
import { tryRequire } from '../../shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths } from '../../shared/tantivy.js';
import { resolveToolRoot } from '../../../tools/dict-utils.js';

const EMPTY_INDEX = { chunkMeta: [], denseVec: null, minhash: null };

export async function loadSearchIndexes({
  rootDir,
  userConfig,
  searchMode,
  runProse,
  runExtractedProse,
  loadExtractedProse = false,
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
  backendLabel,
  backendForcedTantivy,
  indexCache,
  modelIdDefault,
  fileChargramN,
  hnswConfig,
  lancedbConfig,
  tantivyConfig,
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

  const resolvedTantivyConfig = normalizeTantivyConfig(tantivyConfig || userConfig.tantivy || {});
  const tantivyRequired = backendLabel === 'tantivy' || backendForcedTantivy === true;
  const tantivyEnabled = resolvedTantivyConfig.enabled || tantivyRequired;
  if (tantivyRequired) {
    const dep = tryRequire('tantivy');
    if (!dep.ok) {
      throw new Error('Tantivy backend requested but the optional "tantivy" module is not available.');
    }
  }

  const resolveTantivyAvailability = (mode, indexDir) => {
    if (!tantivyEnabled || !indexDir) {
      return { dir: null, metaPath: null, meta: null, available: false };
    }
    const paths = resolveTantivyPaths(indexDir, mode, resolvedTantivyConfig);
    let meta = null;
    if (paths.metaPath && fs.existsSync(paths.metaPath)) {
      try {
        meta = readJsonFile(paths.metaPath, { maxBytes: MAX_JSON_BYTES });
      } catch {}
    }
    const available = Boolean(meta && paths.dir && fs.existsSync(paths.dir));
    return { ...paths, meta, available };
  };

  const ensureTantivyIndex = (mode, indexDir) => {
    const availability = resolveTantivyAvailability(mode, indexDir);
    if (availability.available) return availability;
    if (!tantivyRequired || !resolvedTantivyConfig.autoBuild) return availability;
    const toolRoot = resolveToolRoot();
    const scriptPath = path.join(toolRoot, 'tools', 'build-tantivy-index.js');
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--mode', mode, '--repo', rootDir],
      { stdio: emitOutput ? 'inherit' : 'ignore' }
    );
    if (result.status !== 0) {
      throw new Error(`Tantivy index build failed for mode=${mode}.`);
    }
    return resolveTantivyAvailability(mode, indexDir);
  };

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
  let resolvedLoadExtractedProse = runExtractedProse || loadExtractedProse;
  if (resolvedLoadExtractedProse) {
    if (resolvedRunExtractedProse && (searchMode === 'extracted-prose' || searchMode === 'default')) {
      extractedProseDir = requireIndexDir(rootDir, 'extracted-prose', userConfig, { emitOutput, exitOnError });
    } else {
      extractedProseDir = resolveIndexDir(rootDir, 'extracted-prose', userConfig);
      if (!hasIndexMeta(extractedProseDir)) {
        if (resolvedRunExtractedProse && emitOutput) {
          console.warn('[search] extracted-prose index not found; skipping.');
        }
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
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
  const idxExtractedProse = resolvedLoadExtractedProse
    ? await loadIndexCachedLocal(extractedProseDir, annActive && resolvedRunExtractedProse)
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
  if (resolvedLoadExtractedProse) {
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

  const attachTantivy = (idx, mode, dir) => {
    if (!idx || !dir || !tantivyEnabled) return null;
    const availability = ensureTantivyIndex(mode, dir);
    idx.tantivy = {
      dir: availability.dir,
      metaPath: availability.metaPath,
      meta: availability.meta,
      available: availability.available
    };
    return idx.tantivy;
  };

  attachTantivy(idxCode, 'code', codeIndexDir);
  attachTantivy(idxProse, 'prose', proseIndexDir);
  attachTantivy(idxExtractedProse, 'extracted-prose', extractedProseDir);
  attachTantivy(idxRecords, 'records', recordsDir);

  if (tantivyRequired) {
    const missingModes = [];
    if (runCode && !idxCode?.tantivy?.available) missingModes.push('code');
    if (runProse && !idxProse?.tantivy?.available) missingModes.push('prose');
    if (resolvedRunExtractedProse && !idxExtractedProse?.tantivy?.available) {
      missingModes.push('extracted-prose');
    }
    if (runRecords && !idxRecords?.tantivy?.available) missingModes.push('records');
    if (missingModes.length) {
      throw new Error(`Tantivy index missing for mode(s): ${missingModes.join(', ')}.`);
    }
  }

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
    extractedProseLoaded: resolvedLoadExtractedProse,
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
    extractedProseLoaded: resolvedLoadExtractedProse,
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
