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
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../tools/shared/dict-utils.js';

const EMPTY_INDEX = {
  chunkMeta: [],
  denseVec: null,
  minhash: null,
  filterIndex: null,
  fileRelations: null,
  repoMap: null
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const normalizeModel = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeIdentityNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const numbersEqual = (left, right) => Math.abs(left - right) <= 1e-9;

const extractEmbeddingIdentity = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  const quantization = meta.quantization && typeof meta.quantization === 'object'
    ? meta.quantization
    : null;
  const identity = {};
  const dims = normalizeIdentityNumber(meta.dims);
  if (dims != null) identity.dims = dims;
  const model = normalizeModel(meta.model) || normalizeModel(meta.modelId);
  if (model != null) identity.model = model;
  const scale = normalizeIdentityNumber(meta.scale);
  if (scale != null) identity.scale = scale;
  const minVal = normalizeIdentityNumber(meta.minVal ?? quantization?.minVal);
  if (minVal != null) identity.minVal = minVal;
  const maxVal = normalizeIdentityNumber(meta.maxVal ?? quantization?.maxVal);
  if (maxVal != null) identity.maxVal = maxVal;
  const levels = normalizeIdentityNumber(meta.levels ?? quantization?.levels);
  if (levels != null) identity.levels = levels;
  return identity;
};

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
  resolvedDenseVectorMode,
  requiredArtifacts
}) {
  const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
  const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;
  const runtimeConfig = getRuntimeConfig(rootDir, userConfig);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, process.env);
  const hasRequirements = requiredArtifacts && typeof requiredArtifacts.has === 'function';
  const needsAnnArtifacts = hasRequirements ? requiredArtifacts.has('ann') : true;
  const needsFilterIndex = hasRequirements ? requiredArtifacts.has('filterIndex') : true;
  const needsFileRelations = hasRequirements ? requiredArtifacts.has('fileRelations') : true;
  const needsRepoMap = hasRequirements ? requiredArtifacts.has('repoMap') : true;
  const needsGraphRelations = hasRequirements
    ? requiredArtifacts.has('graphRelations')
    : (contextExpansionEnabled || graphRankingEnabled);
  const needsChunkMetaCold = Boolean(
    filtersActive
    || contextExpansionEnabled
    || graphRankingEnabled
    || needsFilterIndex
    || needsFileRelations
  );
  const lazyDenseVectorsEnabled = userConfig?.retrieval?.dense?.lazyLoad !== false;

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
    const scriptPath = path.join(toolRoot, 'tools', 'build/tantivy-index.js');
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

  const loadIndexCachedLocal = async (dir, options = {}, mode = null) => loadIndexCached({
    indexCache,
    dir,
    modelIdDefault,
    fileChargramN,
    includeHnsw: options.includeHnsw !== false,
    includeDense: options.includeDense !== false,
    includeMinhash: options.includeMinhash !== false,
    includeFilterIndex: options.includeFilterIndex !== false,
    includeFileRelations: options.includeFileRelations !== false,
    includeRepoMap: options.includeRepoMap !== false,
    includeChunkMetaCold: options.includeChunkMetaCold !== false,
    hnswConfig,
    denseVectorMode: resolvedDenseVectorMode,
    loadIndex: (targetDir, loadOptions) => loadIndex(targetDir, {
      ...loadOptions,
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

  const loadOptions = {
    includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
    includeMinhash: needsAnnArtifacts,
    includeFilterIndex: needsFilterIndex,
    includeFileRelations: needsFileRelations,
    includeRepoMap: needsRepoMap,
    includeChunkMetaCold: needsChunkMetaCold,
    includeHnsw: annActive
  };
  const resolveDenseArtifactName = (mode) => {
    if (resolvedDenseVectorMode === 'code') return 'dense_vectors_code';
    if (resolvedDenseVectorMode === 'doc') return 'dense_vectors_doc';
    if (resolvedDenseVectorMode === 'auto') {
      if (mode === 'code') return 'dense_vectors_code';
      if (mode === 'prose' || mode === 'extracted-prose') return 'dense_vectors_doc';
    }
    return 'dense_vectors';
  };
  const attachDenseVectorLoader = (idx, mode, dir) => {
    if (!idx || !dir || !needsAnnArtifacts || !lazyDenseVectorsEnabled) return;
    const artifactName = resolveDenseArtifactName(mode);
    const fallbackPath = path.join(dir, `${artifactName}_uint8.json`);
    let pendingLoad = null;
    idx.loadDenseVectors = async () => {
      if (Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0) {
        return idx.denseVec;
      }
      if (pendingLoad) return pendingLoad;
      pendingLoad = (async () => {
        let manifest = null;
        try {
          manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
        } catch (err) {
          if (err?.code !== 'ERR_MANIFEST_MISSING' && err?.code !== 'ERR_MANIFEST_INVALID') {
            throw err;
          }
        }
        try {
          const loaded = await loadJsonObjectArtifact(dir, artifactName, {
            maxBytes: MAX_JSON_BYTES,
            manifest,
            strict,
            fallbackPath
          });
          if (!loaded || !Array.isArray(loaded.vectors) || !loaded.vectors.length) {
            idx.loadDenseVectors = null;
            return null;
          }
          if (!loaded.model && modelIdDefault) loaded.model = modelIdDefault;
          idx.denseVec = loaded;
          return loaded;
        } catch {
          idx.loadDenseVectors = null;
          return null;
        }
      })().finally(() => {
        pendingLoad = null;
      });
      return pendingLoad;
    };
  };
  const idxProse = runProse
    ? (useSqlite ? loadIndexFromSqlite('prose', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: sqliteContextChunks,
      includeFilterIndex: needsFilterIndex
    }) : (useLmdb ? loadIndexFromLmdb('prose', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: true,
      includeFilterIndex: needsFilterIndex
    }) : await loadIndexCachedLocal(proseDir, loadOptions, 'prose')))
    : { ...EMPTY_INDEX };
  const idxExtractedProse = resolvedLoadExtractedProse
    ? await loadIndexCachedLocal(extractedProseDir, {
      ...loadOptions,
      includeHnsw: annActive && resolvedRunExtractedProse
    }, 'extracted-prose')
    : { ...EMPTY_INDEX };
  const idxCode = runCode
    ? (useSqlite ? loadIndexFromSqlite('code', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: sqliteContextChunks,
      includeFilterIndex: needsFilterIndex
    }) : (useLmdb ? loadIndexFromLmdb('code', {
      includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
      includeMinhash: needsAnnArtifacts,
      includeChunks: true,
      includeFilterIndex: needsFilterIndex
    }) : await loadIndexCachedLocal(codeDir, loadOptions, 'code')))
    : { ...EMPTY_INDEX };
  const idxRecords = runRecords
    ? await loadIndexCachedLocal(recordsDir, loadOptions, 'records')
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

  if (runCode) {
    idxCode.denseVec = resolveDenseVector(idxCode, 'code', resolvedDenseVectorMode);
    if (!idxCode.denseVec && idxCode?.state?.embeddings?.embeddingIdentity) {
      idxCode.denseVec = { ...idxCode.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxCode, 'code', codeIndexDir);
    idxCode.indexDir = codeIndexDir;
    if ((useSqlite || useLmdb) && needsFileRelations && !idxCode.fileRelations) {
      idxCode.fileRelations = loadFileRelations(rootDir, userConfig, 'code');
    }
    if ((useSqlite || useLmdb) && needsRepoMap && !idxCode.repoMap) {
      idxCode.repoMap = loadRepoMap(rootDir, userConfig, 'code');
    }
  }
  if (runProse) {
    idxProse.denseVec = resolveDenseVector(idxProse, 'prose', resolvedDenseVectorMode);
    if (!idxProse.denseVec && idxProse?.state?.embeddings?.embeddingIdentity) {
      idxProse.denseVec = { ...idxProse.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxProse, 'prose', proseIndexDir);
    idxProse.indexDir = proseIndexDir;
    if ((useSqlite || useLmdb) && needsFileRelations && !idxProse.fileRelations) {
      idxProse.fileRelations = loadFileRelations(rootDir, userConfig, 'prose');
    }
    if ((useSqlite || useLmdb) && needsRepoMap && !idxProse.repoMap) {
      idxProse.repoMap = loadRepoMap(rootDir, userConfig, 'prose');
    }
  }
  if (resolvedLoadExtractedProse) {
    idxExtractedProse.denseVec = resolveDenseVector(
      idxExtractedProse,
      'extracted-prose',
      resolvedDenseVectorMode
    );
    if (!idxExtractedProse.denseVec && idxExtractedProse?.state?.embeddings?.embeddingIdentity) {
      idxExtractedProse.denseVec = { ...idxExtractedProse.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxExtractedProse, 'extracted-prose', extractedProseDir);
    idxExtractedProse.indexDir = extractedProseDir;
    if (needsFileRelations && !idxExtractedProse.fileRelations) {
      idxExtractedProse.fileRelations = loadFileRelations(rootDir, userConfig, 'extracted-prose');
    }
    if (needsRepoMap && !idxExtractedProse.repoMap) {
      idxExtractedProse.repoMap = loadRepoMap(rootDir, userConfig, 'extracted-prose');
    }
  }

  if (runRecords) {
    idxRecords.denseVec = resolveDenseVector(idxRecords, 'records', resolvedDenseVectorMode);
    if (!idxRecords.denseVec && idxRecords?.state?.embeddings?.embeddingIdentity) {
      idxRecords.denseVec = { ...idxRecords.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader(idxRecords, 'records', recordsDir);
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
    if (!idx || !dir || !needsGraphRelations) return null;
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

  const attachTasks = [];
  if (needsGraphRelations) {
    attachTasks.push(() => attachGraphRelations(idxCode, codeIndexDir));
  }
  if (needsAnnArtifacts) {
    attachTasks.push(() => attachLanceDb(idxCode, 'code', codeIndexDir));
    attachTasks.push(() => attachLanceDb(idxProse, 'prose', proseIndexDir));
    attachTasks.push(() => attachLanceDb(idxExtractedProse, 'extracted-prose', extractedProseDir));
  }
  if (attachTasks.length) {
    const limit = 2;
    let cursor = 0;
    const runTask = async () => {
      while (cursor < attachTasks.length) {
        const current = cursor;
        cursor += 1;
        await attachTasks[current]();
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, attachTasks.length) }, runTask));
  }

  const validateEmbeddingIdentityForMode = (mode, idx) => {
    if (!idx) return [];
    const sources = [];
    const denseIdentity = extractEmbeddingIdentity(idx.denseVec);
    if (denseIdentity) {
      sources.push({ name: 'dense_vectors', identity: denseIdentity, disable: null });
    }
    const hnswIdentity = extractEmbeddingIdentity(idx.hnsw?.meta);
    if (hnswIdentity) {
      sources.push({
        name: 'hnsw',
        identity: hnswIdentity,
        disable: () => {
          if (!idx.hnsw || typeof idx.hnsw !== 'object') return;
          idx.hnsw.available = false;
          idx.hnsw.index = null;
        }
      });
    }
    const lanceIdentity = extractEmbeddingIdentity(idx.lancedb?.meta);
    if (lanceIdentity) {
      sources.push({
        name: 'lancedb',
        identity: lanceIdentity,
        disable: () => {
          if (!idx.lancedb || typeof idx.lancedb !== 'object') return;
          idx.lancedb.available = false;
        }
      });
    }
    const sqliteVecIdentity = extractEmbeddingIdentity(idx.sqliteVecMeta);
    if (sqliteVecIdentity) {
      sources.push({ name: 'sqlite-vec-meta', identity: sqliteVecIdentity, disable: null });
    }
    if (sources.length <= 1) return [];

    const reference = sources[0];
    const mismatches = [];
    const quantFields = ['scale', 'minVal', 'maxVal', 'levels'];
    for (const source of sources.slice(1)) {
      const beforeCount = mismatches.length;
      const leftDims = normalizeIdentityNumber(reference.identity?.dims);
      const rightDims = normalizeIdentityNumber(source.identity?.dims);
      if (leftDims == null || rightDims == null || !numbersEqual(leftDims, rightDims)) {
        mismatches.push({
          mode,
          source: source.name,
          field: 'dims',
          expected: leftDims,
          actual: rightDims
        });
      }

      const leftModel = normalizeModel(reference.identity?.model);
      const rightModel = normalizeModel(source.identity?.model);
      if (leftModel && rightModel && leftModel !== rightModel) {
        mismatches.push({
          mode,
          source: source.name,
          field: 'model',
          expected: leftModel,
          actual: rightModel
        });
      }

      for (const field of quantFields) {
        const leftHas = hasOwn(reference.identity, field);
        const rightHas = hasOwn(source.identity, field);
        if (leftHas !== rightHas) {
          mismatches.push({
            mode,
            source: source.name,
            field,
            expected: leftHas ? reference.identity[field] : null,
            actual: rightHas ? source.identity[field] : null
          });
          continue;
        }
        if (!leftHas || !rightHas) continue;
        const leftValue = normalizeIdentityNumber(reference.identity[field]);
        const rightValue = normalizeIdentityNumber(source.identity[field]);
        if (leftValue == null || rightValue == null || !numbersEqual(leftValue, rightValue)) {
          mismatches.push({
            mode,
            source: source.name,
            field,
            expected: leftValue,
            actual: rightValue
          });
        }
      }
      if (mismatches.length > beforeCount && !strict && typeof source.disable === 'function') {
        source.disable();
      }
    }
    return mismatches;
  };

  if (needsAnnArtifacts) {
    const identityMismatches = [];
    if (runCode) identityMismatches.push(...validateEmbeddingIdentityForMode('code', idxCode));
    if (runProse) identityMismatches.push(...validateEmbeddingIdentityForMode('prose', idxProse));
    if (resolvedLoadExtractedProse) {
      identityMismatches.push(...validateEmbeddingIdentityForMode('extracted-prose', idxExtractedProse));
    }
    if (runRecords) identityMismatches.push(...validateEmbeddingIdentityForMode('records', idxRecords));
    if (identityMismatches.length) {
      const details = identityMismatches
        .map((entry) => (
          `- ${entry.mode}/${entry.source}: ${entry.field} expected=${entry.expected ?? 'null'} actual=${entry.actual ?? 'null'}`
        ))
        .join('\n');
      if (strict) {
        throw new Error(`Embedding identity mismatch detected:\n${details}`);
      }
      if (emitOutput) {
        console.warn(`[search] Embedding identity mismatch detected; disabling incompatible ANN backends.\n${details}`);
      }
    }
  }

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
