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

  const loadOptions = {
    includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
    includeMinhash: needsAnnArtifacts,
    includeFilterIndex: needsFilterIndex,
    includeFileRelations: needsFileRelations,
    includeRepoMap: needsRepoMap,
    includeChunkMetaCold: needsChunkMetaCold,
    includeHnsw: annActive
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
  let idxExtractedProse = { ...EMPTY_INDEX };
  if (resolvedLoadExtractedProse) {
    try {
      if (useSqlite) {
        try {
          idxExtractedProse = loadIndexFromSqlite('extracted-prose', {
            includeDense: needsAnnArtifacts && !lazyDenseVectorsEnabled,
            includeMinhash: needsAnnArtifacts,
            includeChunks: sqliteContextChunks,
            includeFilterIndex: needsFilterIndex
          });
        } catch {
          idxExtractedProse = await loadIndexCachedLocal(extractedProseDir, {
            ...loadOptions,
            includeHnsw: annActive && resolvedRunExtractedProse
          }, 'extracted-prose');
        }
      } else {
        idxExtractedProse = await loadIndexCachedLocal(extractedProseDir, {
          ...loadOptions,
          includeHnsw: annActive && resolvedRunExtractedProse
        }, 'extracted-prose');
      }
    } catch (err) {
      if (!isMissingManifestLikeError(err) || !disableOptionalExtractedProse('optional extracted-prose artifacts unavailable')) {
        throw err;
      }
      idxExtractedProse = { ...EMPTY_INDEX };
    }
  }
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

  const relationLoadTasks = [];
  if (runCode) {
    idxCode.denseVec = resolveDenseVector(idxCode, 'code', resolvedDenseVectorMode);
    if (!idxCode.denseVec && idxCode?.state?.embeddings?.embeddingIdentity) {
      idxCode.denseVec = { ...idxCode.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader({
      idx: idxCode,
      mode: 'code',
      dir: codeIndexDir,
      needsAnnArtifacts,
      lazyDenseVectorsEnabled,
      resolvedDenseVectorMode,
      strict,
      modelIdDefault
    });
    idxCode.indexDir = codeIndexDir;
    if ((useSqlite || useLmdb) && needsFileRelations && !idxCode.fileRelations) {
      relationLoadTasks.push(
        loadFileRelations(rootDir, userConfig, 'code', { resolveOptions })
          .then((value) => {
            idxCode.fileRelations = value;
          })
      );
    }
    if ((useSqlite || useLmdb) && needsRepoMap && !idxCode.repoMap) {
      relationLoadTasks.push(
        loadRepoMap(rootDir, userConfig, 'code', { resolveOptions })
          .then((value) => {
            idxCode.repoMap = value;
          })
      );
    }
  }
  if (runProse) {
    idxProse.denseVec = resolveDenseVector(idxProse, 'prose', resolvedDenseVectorMode);
    if (!idxProse.denseVec && idxProse?.state?.embeddings?.embeddingIdentity) {
      idxProse.denseVec = { ...idxProse.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader({
      idx: idxProse,
      mode: 'prose',
      dir: proseIndexDir,
      needsAnnArtifacts,
      lazyDenseVectorsEnabled,
      resolvedDenseVectorMode,
      strict,
      modelIdDefault
    });
    idxProse.indexDir = proseIndexDir;
    if ((useSqlite || useLmdb) && needsFileRelations && !idxProse.fileRelations) {
      relationLoadTasks.push(
        loadFileRelations(rootDir, userConfig, 'prose', { resolveOptions })
          .then((value) => {
            idxProse.fileRelations = value;
          })
      );
    }
    if ((useSqlite || useLmdb) && needsRepoMap && !idxProse.repoMap) {
      relationLoadTasks.push(
        loadRepoMap(rootDir, userConfig, 'prose', { resolveOptions })
          .then((value) => {
            idxProse.repoMap = value;
          })
      );
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
    attachDenseVectorLoader({
      idx: idxExtractedProse,
      mode: 'extracted-prose',
      dir: extractedProseDir,
      needsAnnArtifacts,
      lazyDenseVectorsEnabled,
      resolvedDenseVectorMode,
      strict,
      modelIdDefault
    });
    idxExtractedProse.indexDir = extractedProseDir;
    if (needsFileRelations && !idxExtractedProse.fileRelations) {
      relationLoadTasks.push(
        loadFileRelations(rootDir, userConfig, 'extracted-prose', { resolveOptions })
          .then((value) => {
            idxExtractedProse.fileRelations = value;
          })
      );
    }
    if (needsRepoMap && !idxExtractedProse.repoMap) {
      relationLoadTasks.push(
        loadRepoMap(rootDir, userConfig, 'extracted-prose', { resolveOptions })
          .then((value) => {
            idxExtractedProse.repoMap = value;
          })
      );
    }
  }
  if (relationLoadTasks.length) {
    await Promise.all(relationLoadTasks);
  }

  if (runRecords) {
    idxRecords.denseVec = resolveDenseVector(idxRecords, 'records', resolvedDenseVectorMode);
    if (!idxRecords.denseVec && idxRecords?.state?.embeddings?.embeddingIdentity) {
      idxRecords.denseVec = { ...idxRecords.state.embeddings.embeddingIdentity, vectors: null };
    }
    attachDenseVectorLoader({
      idx: idxRecords,
      mode: 'records',
      dir: recordsDir,
      needsAnnArtifacts,
      lazyDenseVectorsEnabled,
      resolvedDenseVectorMode,
      strict,
      modelIdDefault
    });
    idxRecords.indexDir = recordsDir;
  }

  const scmHydrationTasks = [];
  if (runCode) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxCode,
      mode: 'code',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (runProse) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxProse,
      mode: 'prose',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (resolvedLoadExtractedProse) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxExtractedProse,
      mode: 'extracted-prose',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (runRecords) {
    scmHydrationTasks.push(hydrateChunkAuthorsForIndex({
      idx: idxRecords,
      mode: 'records',
      rootDir,
      userConfig,
      fileChargramN,
      filtersActive,
      chunkAuthorFilterActive,
      emitOutput
    }));
  }
  if (scmHydrationTasks.length) {
    await Promise.all(scmHydrationTasks);
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
