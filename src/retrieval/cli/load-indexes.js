import path from 'node:path';
import { spawnSubprocessSync } from '../../shared/subprocess.js';
import { pathExists } from '../../shared/files.js';
import {
  hasIndexMetaAsync,
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
  loadPiecesManifest,
  readJsonFile,
  readCompatibilityKey
} from '../../shared/artifact-io.js';
import { tryRequire } from '../../shared/optional-deps.js';
import { normalizeTantivyConfig, resolveTantivyPaths } from '../../shared/tantivy.js';
import { getRuntimeConfig, resolveRuntimeEnv, resolveToolRoot } from '../../../tools/shared/dict-utils.js';
import {
  attachAnnAndGraphArtifacts,
  attachDenseVectorLoader,
  isMissingManifestLikeError,
  validateEmbeddingIdentity
} from './ann-backends.js';
import { __testScmChunkAuthorHydration, hydrateChunkAuthorsForIndex } from './chunk-authors.js';
import { EMPTY_INDEX } from './filter-index.js';

export { __testScmChunkAuthorHydration };

/**
 * Load retrieval indexes across enabled modes and attach optional ANN/graph
 * side artifacts while enforcing cohort compatibility and embedding identity.
 * In non-strict mode, incompatible ANN sources are disabled instead of failing.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
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
  chunkAuthorFilterActive = false,
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
  allowUnsafeMix = false,
  indexStates = null,
  loadIndexFromSqlite,
  loadIndexFromLmdb,
  resolvedDenseVectorMode,
  requiredArtifacts,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false
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
  const resolveOptions = {
    indexDirByMode,
    indexBaseRootByMode,
    explicitRef
  };

  const proseIndexDir = runProse ? resolveIndexDir(rootDir, 'prose', userConfig, resolveOptions) : null;
  const codeIndexDir = runCode ? resolveIndexDir(rootDir, 'code', userConfig, resolveOptions) : null;
  const proseDir = runProse && !useSqlite
    ? requireIndexDir(rootDir, 'prose', userConfig, { emitOutput, exitOnError, resolveOptions })
    : proseIndexDir;
  const codeDir = runCode && !useSqlite
    ? requireIndexDir(rootDir, 'code', userConfig, { emitOutput, exitOnError, resolveOptions })
    : codeIndexDir;
  const recordsDir = runRecords
    ? requireIndexDir(rootDir, 'records', userConfig, { emitOutput, exitOnError, resolveOptions })
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

  const resolveTantivyAvailability = async (mode, indexDir) => {
    if (!tantivyEnabled || !indexDir) {
      return { dir: null, metaPath: null, meta: null, available: false };
    }
    const paths = resolveTantivyPaths(indexDir, mode, resolvedTantivyConfig);
    let meta = null;
    if (paths.metaPath && await pathExists(paths.metaPath)) {
      try {
        meta = readJsonFile(paths.metaPath, { maxBytes: MAX_JSON_BYTES });
      } catch {}
    }
    const available = Boolean(meta && paths.dir && await pathExists(paths.dir));
    return { ...paths, meta, available };
  };

  const ensureTantivyIndex = async (mode, indexDir) => {
    const availability = await resolveTantivyAvailability(mode, indexDir);
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
  const disableOptionalExtractedProse = (reason = null) => {
    if (!resolvedLoadExtractedProse || resolvedRunExtractedProse) return false;
    if (reason && emitOutput) {
      console.warn(`[search] ${reason}; skipping extracted-prose comment joins.`);
    }
    resolvedLoadExtractedProse = false;
    extractedProseDir = null;
    return true;
  };
  if (resolvedLoadExtractedProse) {
    if (resolvedRunExtractedProse && (searchMode === 'extracted-prose' || searchMode === 'default')) {
      extractedProseDir = requireIndexDir(rootDir, 'extracted-prose', userConfig, {
        emitOutput,
        exitOnError,
        resolveOptions
      });
    } else {
      try {
        extractedProseDir = resolveIndexDir(rootDir, 'extracted-prose', userConfig, resolveOptions);
      } catch (error) {
        if (error?.code !== 'NO_INDEX') throw error;
        // Optional comment-join path: explicit as-of refs should not hard-fail when extracted-prose
        // was not requested and is unavailable for the selected snapshot/build.
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
      }
      if (!await hasIndexMetaAsync(extractedProseDir)) {
        if (resolvedRunExtractedProse && emitOutput) {
          console.warn('[search] extracted-prose index not found; skipping.');
        }
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
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
    if (resolvedRunExtractedProse && resolvedLoadExtractedProse) ensureManifest(extractedProseDir);
  }

  const includeExtractedProseInCompatibility = resolvedLoadExtractedProse;
  const compatibilityTargetCandidates = [
    runCode ? { mode: 'code', dir: codeDir } : null,
    runProse ? { mode: 'prose', dir: proseDir } : null,
    runRecords ? { mode: 'records', dir: recordsDir } : null,
    includeExtractedProseInCompatibility ? { mode: 'extracted-prose', dir: extractedProseDir } : null
  ].filter((entry) => entry && entry.dir);
  const compatibilityChecks = await Promise.all(
    compatibilityTargetCandidates.map(async (entry) => ({
      entry,
      hasMeta: await hasIndexMetaAsync(entry.dir)
    }))
  );
  const compatibilityTargets = compatibilityChecks
    .filter((check) => check.hasMeta)
    .map((check) => check.entry);
  if (compatibilityTargets.length) {
    const compatibilityResults = await Promise.all(
      compatibilityTargets.map(async (entry) => {
        const strictCompatibilityKey = strict && (entry.mode !== 'extracted-prose' || resolvedRunExtractedProse);
        const { key } = readCompatibilityKey(entry.dir, {
          maxBytes: MAX_JSON_BYTES,
          strict: strictCompatibilityKey
        });
        return { mode: entry.mode, key };
      })
    );
    const keys = new Map(compatibilityResults.map((entry) => [entry.mode, entry.key]));
    let keysToValidate = keys;
    const hasMixedCompatibilityKeys = (map) => (new Set(map.values())).size > 1;
    if (hasMixedCompatibilityKeys(keysToValidate) && !resolvedRunExtractedProse && keysToValidate.has('extracted-prose')) {
      const filtered = new Map(Array.from(keysToValidate.entries()).filter(([mode]) => mode !== 'extracted-prose'));
      if (!hasMixedCompatibilityKeys(filtered)) {
        if (emitOutput) {
          console.warn('[search] extracted-prose index mismatch; skipping comment joins.');
        }
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
        keysToValidate = filtered;
      }
    }
    if (hasMixedCompatibilityKeys(keysToValidate)) {
      const details = Array.from(keysToValidate.entries())
        .map(([mode, key]) => `- ${mode}: ${key}`)
        .join('\n');
      if (allowUnsafeMix === true) {
        if (emitOutput) {
          console.warn(
            '[search] compatibilityKey mismatch overridden via --allow-unsafe-mix. ' +
            'Results may combine incompatible index cohorts:\n' +
            details
          );
        }
      } else {
        throw new Error(`Incompatible indexes detected (compatibilityKey mismatch):\n${details}`);
      }
    }
  }

  const denseArtifactsEnabled = needsAnnArtifacts && !lazyDenseVectorsEnabled;
  const emptyIndex = () => ({ ...EMPTY_INDEX });
  const baseBackendLoadOptions = {
    includeDense: denseArtifactsEnabled,
    includeMinhash: needsAnnArtifacts,
    includeFilterIndex: needsFilterIndex
  };
  const sqliteBackendLoadOptions = {
    ...baseBackendLoadOptions,
    includeChunks: sqliteContextChunks
  };
  const lmdbBackendLoadOptions = {
    ...baseBackendLoadOptions,
    includeChunks: true
  };
  const cachedLoadOptions = {
    ...baseBackendLoadOptions,
    includeFileRelations: needsFileRelations,
    includeRepoMap: needsRepoMap,
    includeChunkMetaCold: needsChunkMetaCold,
    includeHnsw: annActive
  };
  const loadCachedModeIndex = (mode, dir, modeLoadOptions = cachedLoadOptions) => (
    loadIndexCachedLocal(dir, modeLoadOptions, mode)
  );
  const loadModeIndex = async ({
    mode,
    run,
    dir,
    backend = 'cached',
    modeLoadOptions = cachedLoadOptions,
    allowSqliteFallback = false
  }) => {
    if (!run) return emptyIndex();
    if (backend === 'sqlite') {
      if (allowSqliteFallback) {
        try {
          return loadIndexFromSqlite(mode, sqliteBackendLoadOptions);
        } catch {
          return loadCachedModeIndex(mode, dir, modeLoadOptions);
        }
      }
      return loadIndexFromSqlite(mode, sqliteBackendLoadOptions);
    }
    if (backend === 'lmdb') {
      return loadIndexFromLmdb(mode, lmdbBackendLoadOptions);
    }
    return loadCachedModeIndex(mode, dir, modeLoadOptions);
  };

  const primaryBackend = useSqlite ? 'sqlite' : (useLmdb ? 'lmdb' : 'cached');
  const idxProse = await loadModeIndex({
    mode: 'prose',
    run: runProse,
    dir: proseDir,
    backend: primaryBackend
  });
  let idxExtractedProse = emptyIndex();
  if (resolvedLoadExtractedProse) {
    const extractedCachedLoadOptions = {
      ...cachedLoadOptions,
      includeHnsw: annActive && resolvedRunExtractedProse
    };
    try {
      idxExtractedProse = await loadModeIndex({
        mode: 'extracted-prose',
        run: true,
        dir: extractedProseDir,
        backend: useSqlite ? 'sqlite' : 'cached',
        modeLoadOptions: extractedCachedLoadOptions,
        allowSqliteFallback: useSqlite
      });
    } catch (err) {
      if (!isMissingManifestLikeError(err) || !disableOptionalExtractedProse('optional extracted-prose artifacts unavailable')) {
        throw err;
      }
      idxExtractedProse = emptyIndex();
    }
  }
  const idxCode = await loadModeIndex({
    mode: 'code',
    run: runCode,
    dir: codeDir,
    backend: primaryBackend
  });
  const idxRecords = await loadModeIndex({
    mode: 'records',
    run: runRecords,
    dir: recordsDir
  });

  const applyFallbackIndexState = (idx, mode) => {
    if (!idx?.state && indexStates?.[mode]) {
      idx.state = indexStates[mode];
    }
  };
  applyFallbackIndexState(idxCode, 'code');
  applyFallbackIndexState(idxProse, 'prose');
  applyFallbackIndexState(idxExtractedProse, 'extracted-prose');
  applyFallbackIndexState(idxRecords, 'records');

  warnPendingState(idxCode, 'code', { emitOutput, useSqlite, annActive });
  warnPendingState(idxProse, 'prose', { emitOutput, useSqlite, annActive });
  warnPendingState(idxExtractedProse, 'extracted-prose', { emitOutput, useSqlite, annActive });

  const relationLoadTasks = [];
  const queueRelationLoad = ({ idx, mode, relation, loader }) => {
    relationLoadTasks.push(
      loader(rootDir, userConfig, mode, { resolveOptions })
        .then((value) => {
          idx[relation] = value;
        })
    );
  };
  const hydrateLoadedIndex = ({
    idx,
    mode,
    dir,
    loadRelations = false
  }) => {
    idx.denseVec = resolveDenseVector(idx, mode, resolvedDenseVectorMode);
    if (!idx.denseVec && idx?.state?.embeddings?.embeddingIdentity) {
      idx.denseVec = { ...idx.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader({
      idx,
      mode,
      dir,
      needsAnnArtifacts,
      lazyDenseVectorsEnabled,
      resolvedDenseVectorMode,
      strict,
      modelIdDefault
    });
    idx.indexDir = dir;
    if (loadRelations && needsFileRelations && !idx.fileRelations) {
      queueRelationLoad({ idx, mode, relation: 'fileRelations', loader: loadFileRelations });
    }
    if (loadRelations && needsRepoMap && !idx.repoMap) {
      queueRelationLoad({ idx, mode, relation: 'repoMap', loader: loadRepoMap });
    }
  };

  if (runCode) {
    hydrateLoadedIndex({
      idx: idxCode,
      mode: 'code',
      dir: codeIndexDir,
      loadRelations: useSqlite || useLmdb
    });
  }
  if (runProse) {
    hydrateLoadedIndex({
      idx: idxProse,
      mode: 'prose',
      dir: proseIndexDir,
      loadRelations: useSqlite || useLmdb
    });
  }
  if (resolvedLoadExtractedProse) {
    hydrateLoadedIndex({
      idx: idxExtractedProse,
      mode: 'extracted-prose',
      dir: extractedProseDir,
      loadRelations: true
    });
  }
  if (runRecords) {
    hydrateLoadedIndex({
      idx: idxRecords,
      mode: 'records',
      dir: recordsDir
    });
  }
  if (relationLoadTasks.length) {
    await Promise.all(relationLoadTasks);
  }

  const scmHydrationTargets = [
    runCode ? { idx: idxCode, mode: 'code' } : null,
    runProse ? { idx: idxProse, mode: 'prose' } : null,
    resolvedLoadExtractedProse ? { idx: idxExtractedProse, mode: 'extracted-prose' } : null,
    runRecords ? { idx: idxRecords, mode: 'records' } : null
  ].filter(Boolean);
  if (scmHydrationTargets.length) {
    await Promise.all(
      scmHydrationTargets.map(({ idx, mode }) => hydrateChunkAuthorsForIndex({
        idx,
        mode,
        rootDir,
        userConfig,
        fileChargramN,
        filtersActive,
        chunkAuthorFilterActive,
        emitOutput
      }))
    );
  }

  await attachAnnAndGraphArtifacts({
    needsGraphRelations,
    needsAnnArtifacts,
    idxCode,
    idxProse,
    idxExtractedProse,
    codeIndexDir,
    proseIndexDir,
    extractedProseDir,
    resolvedRunExtractedProse,
    resolvedLoadExtractedProse,
    lancedbConfig,
    resolvedDenseVectorMode,
    strict,
    emitOutput
  });
  validateEmbeddingIdentity({
    needsAnnArtifacts,
    runCode,
    runProse,
    resolvedLoadExtractedProse,
    runRecords,
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords,
    strict,
    emitOutput
  });

  const attachTantivy = async (idx, mode, dir) => {
    if (!idx || !dir || !tantivyEnabled) return null;
    const availability = await ensureTantivyIndex(mode, dir);
    idx.tantivy = {
      dir: availability.dir,
      metaPath: availability.metaPath,
      meta: availability.meta,
      available: availability.available
    };
    return idx.tantivy;
  };

  await Promise.all([
    attachTantivy(idxCode, 'code', codeIndexDir),
    attachTantivy(idxProse, 'prose', proseIndexDir),
    attachTantivy(idxExtractedProse, 'extracted-prose', extractedProseDir),
    attachTantivy(idxRecords, 'records', recordsDir)
  ]);

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
