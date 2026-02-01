import fs from 'node:fs';
import path from 'node:path';
import { spawnSubprocessSync } from '../../shared/subprocess.js';
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
import {
  MAX_JSON_BYTES,
  loadGraphRelations,
  loadJsonObjectArtifact,
  loadPiecesManifest,
  readJsonFile,
  readCompatibilityKey,
  resolveArtifactPresence,
  resolveDirArtifactPath
} from '../../shared/artifact-io.js';
import { resolveLanceDbPaths, resolveLanceDbTarget } from '../../shared/lancedb.js';
import { tryRequire } from '../../shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths } from '../../shared/tantivy.js';
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../tools/dict-utils.js';

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
  graphRankingEnabled,
  sqliteFtsRequested,
  backendLabel,
  backendForcedTantivy,
  indexCache,
  modelIdDefault,
  fileChargramN,
  hnswConfig,
  lancedbConfig,
  tantivyConfig,
  strict = true,
  indexStates = null,
  loadIndexFromSqlite,
  loadIndexFromLmdb,
  resolvedDenseVectorMode
}) {
  const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
  const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;
  const runtimeConfig = getRuntimeConfig(rootDir, userConfig);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, process.env);

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
    const result = spawnSubprocessSync(
      process.execPath,
      [scriptPath, '--mode', mode, '--repo', rootDir],
      {
        stdio: emitOutput ? 'inherit' : 'ignore',
        rejectOnNonZeroExit: false,
        env: runtimeEnv
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Tantivy index build failed for mode=${mode}.`);
    }
    return resolveTantivyAvailability(mode, indexDir);
  };

  const loadIndexCachedLocal = async (dir, includeHnsw = true, mode = null) => loadIndexCached({
    indexCache,
    dir,
    modelIdDefault,
    fileChargramN,
    includeHnsw,
    hnswConfig,
    denseVectorMode: resolvedDenseVectorMode,
    loadIndex: (targetDir, options) => loadIndex(targetDir, {
      ...options,
      strict,
      mode,
      denseVectorMode: resolvedDenseVectorMode
    })
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

  if (strict) {
    const ensureManifest = (dir) => {
      if (!dir) return;
      loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict: true });
    };
    if (runCode) ensureManifest(codeDir);
    if (runProse) ensureManifest(proseDir);
    if (runRecords) ensureManifest(recordsDir);
    if (resolvedLoadExtractedProse) ensureManifest(extractedProseDir);
  }

  const compatibilityTargets = [
    runCode ? { mode: 'code', dir: codeDir } : null,
    runProse ? { mode: 'prose', dir: proseDir } : null,
    runRecords ? { mode: 'records', dir: recordsDir } : null,
    resolvedLoadExtractedProse ? { mode: 'extracted-prose', dir: extractedProseDir } : null
  ].filter((entry) => entry && entry.dir && hasIndexMeta(entry.dir));
  if (compatibilityTargets.length) {
    const keys = new Map();
    for (const entry of compatibilityTargets) {
      const { key } = readCompatibilityKey(entry.dir, { maxBytes: MAX_JSON_BYTES, strict });
      keys.set(entry.mode, key);
    }
    const uniqueKeys = new Set(keys.values());
    if (uniqueKeys.size > 1) {
      if (!resolvedRunExtractedProse && keys.has('extracted-prose')) {
        const filtered = new Map(Array.from(keys.entries()).filter(([mode]) => mode !== 'extracted-prose'));
        const filteredKeys = new Set(filtered.values());
        if (filteredKeys.size <= 1) {
          if (emitOutput) {
            console.warn('[search] extracted-prose index mismatch; skipping comment joins.');
          }
          resolvedLoadExtractedProse = false;
          extractedProseDir = null;
        } else {
          const details = Array.from(keys.entries())
            .map(([mode, key]) => `- ${mode}: ${key}`)
            .join('\n');
          throw new Error(`Incompatible indexes detected (compatibilityKey mismatch):\n${details}`);
        }
      } else {
        const details = Array.from(keys.entries())
          .map(([mode, key]) => `- ${mode}: ${key}`)
          .join('\n');
        throw new Error(`Incompatible indexes detected (compatibilityKey mismatch):\n${details}`);
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
    }) : await loadIndexCachedLocal(proseDir, annActive, 'prose')))
    : { ...EMPTY_INDEX };
  const idxExtractedProse = resolvedLoadExtractedProse
    ? await loadIndexCachedLocal(extractedProseDir, annActive && resolvedRunExtractedProse, 'extracted-prose')
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
    }) : await loadIndexCachedLocal(codeDir, annActive, 'code')))
    : { ...EMPTY_INDEX };
  const idxRecords = runRecords
    ? await loadIndexCachedLocal(recordsDir, annActive, 'records')
    : { ...EMPTY_INDEX };

  if (!idxCode.state && indexStates?.code) idxCode.state = indexStates.code;
  if (!idxProse.state && indexStates?.prose) idxProse.state = indexStates.prose;
  if (!idxExtractedProse.state && indexStates?.['extracted-prose']) {
    idxExtractedProse.state = indexStates['extracted-prose'];
  }
  if (!idxRecords.state && indexStates?.records) idxRecords.state = indexStates.records;

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

  const attachLanceDb = async (idx, mode, dir) => {
    if (!idx || !dir || lancedbConfig?.enabled === false) return null;
    const paths = resolveLanceDbPaths(dir);
    const target = resolveLanceDbTarget(mode, resolvedDenseVectorMode);
    const targetPaths = paths?.[target] || {};
    const metaName = target === 'doc'
      ? 'dense_vectors_doc_lancedb_meta'
      : target === 'code'
        ? 'dense_vectors_code_lancedb_meta'
        : 'dense_vectors_lancedb_meta';
    const dirName = target === 'doc'
      ? 'dense_vectors_doc_lancedb'
      : target === 'code'
        ? 'dense_vectors_code_lancedb'
        : 'dense_vectors_lancedb';
    let manifest = null;
    try {
      manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
    } catch (err) {
      if (err?.code !== 'ERR_MANIFEST_MISSING' && err?.code !== 'ERR_MANIFEST_INVALID') {
        throw err;
      }
      idx.lancedb = {
        target,
        dir: null,
        metaPath: targetPaths.metaPath || null,
        meta: null,
        available: false
      };
      return idx.lancedb;
    }
    let meta = null;
    try {
      meta = await loadJsonObjectArtifact(dir, metaName, {
        maxBytes: MAX_JSON_BYTES,
        manifest,
        strict,
        fallbackPath: targetPaths.metaPath || null
      });
    } catch {}
    let lanceDir = null;
    try {
      lanceDir = resolveDirArtifactPath(dir, dirName, {
        manifest,
        strict,
        fallbackPath: targetPaths.dir || null
      });
    } catch (err) {
      if (err?.code !== 'ERR_MANIFEST_MISSING' && err?.code !== 'ERR_MANIFEST_INVALID') {
        throw err;
      }
    }
    const available = Boolean(meta && lanceDir && fs.existsSync(lanceDir));
    idx.lancedb = {
      target,
      dir: lanceDir || null,
      metaPath: targetPaths.metaPath || null,
      meta,
      available
    };
    return idx.lancedb;
  };

  const attachGraphRelations = async (idx, dir) => {
    if (!idx || !dir || (!contextExpansionEnabled && !graphRankingEnabled)) return null;
    let manifest = null;
    try {
      manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
    } catch (err) {
      if (err?.code === 'ERR_MANIFEST_MISSING' || err?.code === 'ERR_MANIFEST_INVALID') {
        return null;
      }
      throw err;
    }
    const presence = resolveArtifactPresence(dir, 'graph_relations', {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict
    });
    if (!presence || presence.format === 'missing' || presence.error || presence.missingPaths?.length) {
      idx.graphRelations = null;
      return null;
    }
    try {
      idx.graphRelations = await loadGraphRelations(dir, {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict
      });
      return idx.graphRelations;
    } catch (err) {
      if (emitOutput) {
        console.warn(
          `[search] graph_relations load failed (${err?.message || err}); using name-based context expansion.`
        );
      }
      idx.graphRelations = null;
      return null;
    }
  };

  await attachGraphRelations(idxCode, codeIndexDir);
  await attachLanceDb(idxCode, 'code', codeIndexDir);
  await attachLanceDb(idxProse, 'prose', proseIndexDir);
  await attachLanceDb(idxExtractedProse, 'extracted-prose', extractedProseDir);

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
