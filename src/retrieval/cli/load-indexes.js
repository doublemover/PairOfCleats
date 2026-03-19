import { warnPendingState } from './index-loader.js';
import { resolveModelIds } from './model-ids.js';
import {
  attachAnnAndGraphArtifacts,
  isMissingManifestLikeError,
  validateEmbeddingIdentity
} from './ann-backends.js';
import {
  __testScmChunkAuthorHydration,
  hydrateChunkAuthorIndexes
} from './load-indexes/chunk-author-loader.js';
import { createIndexBackendLoader } from './load-indexes/backend.js';
import { applyFallbackIndexStates, hydrateLoadedIndexes } from './load-indexes/filter-loader.js';
import { resolveSearchIndexMetadata } from './load-indexes/metadata.js';

export { __testScmChunkAuthorHydration };

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
  indexMetaByMode = null,
  indexStates = null,
  loadIndexFromSqlite,
  loadIndexFromLmdb,
  resolvedDenseVectorMode,
  requiredArtifacts,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false
}) {
  const metadata = await resolveSearchIndexMetadata({
    rootDir,
    userConfig,
    searchMode,
    runProse,
    runExtractedProse,
    loadExtractedProse,
    runCode,
    runRecords,
    useSqlite,
    emitOutput,
    exitOnError,
    strict,
    allowUnsafeMix,
    indexMetaByMode,
    indexDirByMode,
    indexBaseRootByMode,
    explicitRef
  });

  let {
    resolveOptions,
    proseIndexDir,
    codeIndexDir,
    proseDir,
    codeDir,
    recordsDir,
    extractedProseDir,
    resolvedRunExtractedProse,
    resolvedLoadExtractedProse
  } = metadata;

  const backendLoader = createIndexBackendLoader({
    rootDir,
    userConfig,
    useSqlite,
    useLmdb,
    emitOutput,
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
    tantivyConfig,
    strict,
    resolvedDenseVectorMode,
    requiredArtifacts,
    loadIndexFromSqlite,
    loadIndexFromLmdb
  });

  const disableOptionalExtractedProse = (reason = null) => {
    if (!resolvedLoadExtractedProse || resolvedRunExtractedProse) return false;
    if (reason && emitOutput) {
      console.warn(`[search] ${reason}; skipping extracted-prose comment joins.`);
    }
    resolvedLoadExtractedProse = false;
    extractedProseDir = null;
    return true;
  };

  const primaryBackend = backendLoader.resolvePrimaryBackend();
  const proseLoadPromise = backendLoader.loadModeIndex({
    mode: 'prose',
    run: runProse,
    dir: proseDir,
    backend: primaryBackend
  });
  const codeLoadPromise = backendLoader.loadModeIndex({
    mode: 'code',
    run: runCode,
    dir: codeDir,
    backend: primaryBackend
  });
  const recordsLoadPromise = backendLoader.loadModeIndex({
    mode: 'records',
    run: runRecords,
    dir: recordsDir
  });
  const extractedLoadPromise = resolvedLoadExtractedProse
    ? (async () => {
      const extractedCachedLoadOptions = {
        ...backendLoader.cachedLoadOptions,
        includeHnsw: annActive && resolvedRunExtractedProse
      };
      try {
        return await backendLoader.loadModeIndex({
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
        return backendLoader.emptyIndex();
      }
    })()
    : Promise.resolve(backendLoader.emptyIndex());

  let idxProse = backendLoader.emptyIndex();
  let idxExtractedProse = backendLoader.emptyIndex();
  let idxCode = backendLoader.emptyIndex();
  let idxRecords = backendLoader.emptyIndex();
  [idxProse, idxExtractedProse, idxCode, idxRecords] = await Promise.all([
    proseLoadPromise,
    extractedLoadPromise,
    codeLoadPromise,
    recordsLoadPromise
  ]);

  applyFallbackIndexStates({
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords,
    indexStates
  });

  warnPendingState(idxCode, 'code', { emitOutput, useSqlite, annActive });
  warnPendingState(idxProse, 'prose', { emitOutput, useSqlite, annActive });
  warnPendingState(idxExtractedProse, 'extracted-prose', { emitOutput, useSqlite, annActive });

  await hydrateLoadedIndexes({
    rootDir,
    userConfig,
    useSqlite,
    useLmdb,
    needsFileRelations: backendLoader.needsFileRelations,
    needsRepoMap: backendLoader.needsRepoMap,
    needsAnnArtifacts: backendLoader.needsAnnArtifacts,
    lazyDenseVectorsEnabled: backendLoader.lazyDenseVectorsEnabled,
    resolvedDenseVectorMode,
    strict,
    modelIdDefault,
    codeIndexDir,
    proseIndexDir,
    extractedProseDir,
    recordsDir,
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords,
    runCode,
    runProse,
    runRecords,
    resolvedLoadExtractedProse,
    resolveOptions
  });

  await hydrateChunkAuthorIndexes({
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords,
    runCode,
    runProse,
    runRecords,
    resolvedLoadExtractedProse,
    rootDir,
    userConfig,
    fileChargramN,
    filtersActive,
    chunkAuthorFilterActive,
    emitOutput
  });

  await attachAnnAndGraphArtifacts({
    needsGraphRelations: backendLoader.needsGraphRelations,
    needsAnnArtifacts: backendLoader.needsAnnArtifacts,
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
    needsAnnArtifacts: backendLoader.needsAnnArtifacts,
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

  await Promise.all([
    backendLoader.attachTantivy(idxCode, 'code', codeIndexDir),
    backendLoader.attachTantivy(idxProse, 'prose', proseIndexDir),
    backendLoader.attachTantivy(idxExtractedProse, 'extracted-prose', extractedProseDir),
    backendLoader.attachTantivy(idxRecords, 'records', recordsDir)
  ]);
  backendLoader.assertRequiredTantivy({
    runCode,
    runProse,
    runRecords,
    resolvedRunExtractedProse,
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords
  });

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
