import { compileFilterPredicates } from '../output/filters.js';
import { createFilterEnumeration } from '../pipeline/filter-enumeration.js';
import { resolveRetrievalCacheDir } from './cache-paths.js';
import { incCacheEvent } from '../../shared/metrics/core.js';
import { ERROR_CODES } from '../../shared/error-codes.js';
import { createSearchPipeline } from '../pipeline.js';
import { createRetrievalExecutionOutcome } from '../pipeline/execution-outcome.js';
import { runSearchByMode } from './search-runner.js';
import { resolveSqliteFtsRoutingByMode } from '../routing-policy.js';
import {
  resolveQueryCachePolicy,
  resolveEmbeddingInputFormattingByMode,
  resolveQueryCacheLookup
} from './run-search-session/cache-policy.js';
import { createEmbeddingResolver } from './run-search-session/embedding-cache.js';
import { createModeExpander } from './run-search-session/mode-expansion.js';
import {
  persistSearchSession,
  resolveAnnBackendUsed
} from './run-search-session/persist.js';
import {
  attachCommentExcerpts,
  buildCommentLookup,
  needsCommentExcerpts
} from './run-search-session/comment-excerpts.js';
import { normalizeDenseVectorMode } from '../../shared/dense-vector-mode.js';
import { isDenseVectorPayloadAvailable } from '../../shared/dense-vector-artifacts.js';
import { resolveChunkAuthorCacheEvidence } from './chunk-author-cache.js';
import { createRetrievalWorkObservation } from '../../contracts/retrieval-work.js';

const EMBEDDING_MODE_ORDER = Object.freeze([
  'code',
  'prose',
  'extracted-prose',
  'records'
]);

const EXPANSION_MODE_ORDER = Object.freeze([
  'prose',
  'extracted-prose',
  'code',
  'records'
]);

/**
 * sqlite-vec only supports merged vectors. When a split dense mode is selected,
 * mark sqlite ANN unavailable for every mode so downstream routing cannot pick
 * an incompatible ANN provider.
 *
 * Mutates `vectorAnnState` in place.
 *
 * @param {object} input
 * @param {string} input.resolvedDenseMode
 * @param {boolean} input.vectorAnnEnabled
 * @param {Record<string, {available?: boolean}>|null} input.vectorAnnState
 * @returns {void}
 */
function enforceSqliteAnnDenseModeCompatibility({
  resolvedDenseMode,
  vectorAnnEnabled,
  vectorAnnState
}) {
  if (resolvedDenseMode === 'merged' || !vectorAnnEnabled || !vectorAnnState) return;
  let hasSqliteAnn = false;
  for (const entry of Object.values(vectorAnnState)) {
    if (!entry) continue;
    if (entry.available === true) {
      hasSqliteAnn = true;
    }
    entry.available = false;
  }
  if (!hasSqliteAnn) return;
  console.warn(
    `[ann] sqlite-vec only supports merged vectors; disabling sqlite ANN for denseVectorMode=${resolvedDenseMode}.`
  );
}

/**
 * Resolve all cache-related runtime state in one place so cache lookup and
 * embedding input formatting stay keyed to the same policy snapshot.
 *
 * @param {object} input
 * @param {object} input.queryCachePolicyInput
 * @param {object} input.embeddingInputFormattingInput
 * @param {object} input.cacheLookupInput
 * @returns {Promise<object>}
 */
async function resolveSessionCacheState({
  queryCachePolicyInput,
  embeddingInputFormattingInput,
  cacheLookupInput
}) {
  const {
    cacheStrategy,
    cachePrewarmEnabled,
    cachePrewarmLimit,
    cacheMemoryFreshMs,
    sqliteFtsOverfetchCacheKey
  } = resolveQueryCachePolicy(queryCachePolicyInput);
  const embeddingInputFormattingByMode = resolveEmbeddingInputFormattingByMode(
    embeddingInputFormattingInput
  );
  const cacheLookup = await resolveQueryCacheLookup({
    ...cacheLookupInput,
    sqliteFtsOverfetchCacheKey,
    embeddingInputFormattingByMode,
    cacheStrategy,
    cachePrewarmEnabled,
    cachePrewarmLimit,
    cacheMemoryFreshMs
  });

  return {
    cacheStrategy,
    embeddingInputFormattingByMode,
    ...cacheLookup
  };
}

/**
 * Build per-mode runtime descriptors used by embedding resolution, search
 * execution, and context expansion.
 *
 * @param {object} input
 * @returns {Record<string, {run:boolean,idx:any,modelId:any,inputFormatting:any}>}
 */
function createModeState({
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords,
  modelIds,
  embeddingInputFormattingByMode
}) {
  return {
    code: {
      run: runCode,
      idx: idxCode,
      modelId: modelIds.code,
      inputFormatting: embeddingInputFormattingByMode.code
    },
    prose: {
      run: runProse,
      idx: idxProse,
      modelId: modelIds.prose,
      inputFormatting: embeddingInputFormattingByMode.prose
    },
    'extracted-prose': {
      run: runExtractedProse,
      idx: idxExtractedProse,
      modelId: modelIds.extractedProse,
      inputFormatting: embeddingInputFormattingByMode.extractedProse
    },
    records: {
      run: runRecords,
      idx: idxRecords,
      modelId: modelIds.records,
      inputFormatting: embeddingInputFormattingByMode.records
    }
  };
}

/**
 * Derive ANN availability metadata for each mode from loaded indexes and ANN
 * backend state.
 *
 * This mutates the mode-state entries to avoid duplicating large structures.
 *
 * @param {object} input
 * @returns {object}
 */
async function resolveModeAnnMetadata({
  modeState,
  vectorAnnState,
  hnswAnnState,
  lanceAnnState,
  probeLazyDense = false
}) {
  await Promise.all(EMBEDDING_MODE_ORDER.map(async mode => {
    const state = modeState[mode];
    const idx = state.idx;
    const hasReadyBackend = Boolean(vectorAnnState?.[mode]?.available
      || hnswAnnState?.[mode]?.available || lanceAnnState?.[mode]?.available);
    // A lazy loader is an I/O capability, not evidence of an indexed vector.
    // Resolve it only for active uncached ANN searches before provider selection.
    if (probeLazyDense && state.run && !hasReadyBackend && !isDenseVectorPayloadAvailable(idx?.denseVec)
      && typeof idx?.loadDenseVectors === 'function') await idx.loadDenseVectors();
    state.hasAnn = Boolean(
      isDenseVectorPayloadAvailable(idx?.denseVec)
      || hasReadyBackend
    );
    state.embeddingDims = (
      idx?.denseVec?.dims
      ?? idx?.hnsw?.meta?.dims
      ?? lanceAnnState?.[mode]?.dims
      ?? null
    );
    state.embeddingNormalize = idx?.state?.embeddings?.embeddingIdentity?.normalize !== false;
    state.embeddingModelProfile = idx?.state?.embeddings?.embeddingIdentity?.modelProfile || null;
    state.embeddingIdentity = idx?.state?.embeddings?.embeddingIdentity || null;
  }));
  return modeState;
}

/**
 * Resolve query embeddings for ANN-capable active modes in deterministic mode
 * order so provider work is reproducible across runs.
 *
 * @param {object} input
 * @returns {Promise<Record<string, any>>}
 */
async function resolveQueryEmbeddingsByMode({
  modeState,
  needsEmbedding,
  getEmbeddingForModel
}) {
  const embeddingsByMode = {
    code: null,
    prose: null,
    'extracted-prose': null,
    records: null
  };
  if (!needsEmbedding) return embeddingsByMode;
  for (const mode of EMBEDDING_MODE_ORDER) {
    const state = modeState[mode];
    if (!(state.run && state.hasAnn)) continue;
    embeddingsByMode[mode] = () => getEmbeddingForModel(
      state.modelId,
      state.embeddingDims,
      state.embeddingNormalize,
      state.inputFormatting,
      state.embeddingModelProfile,
      state.embeddingIdentity,
      mode
    );
  }
  return embeddingsByMode;
}

/**
 * Normalize persisted cache payload shape into the same output shape produced
 * by fresh search execution.
 *
 * @param {any} cachedPayload
 * @returns {{proseHits:any[],extractedProseHits:any[],codeHits:any[],recordHits:any[]}|null}
 */
function resolveCachedHits(cachedPayload) {
  if (!cachedPayload) return null;
  return {
    proseHits: cachedPayload.prose || [],
    extractedProseHits: cachedPayload.extractedProse || [],
    codeHits: cachedPayload.code || [],
    recordHits: cachedPayload.records || []
  };
}

/**
 * Apply context expansion to each enabled mode while preserving pass-through
 * hits for disabled modes.
 *
 * @param {object} input
 * @returns {Promise<Record<string, {hits:any[],contextHits:any[]}>>}
 */
async function expandSessionHitsByMode({
  expandModeHits,
  modeState,
  hitsByMode
}) {
  const expandedByMode = {};
  for (const mode of EXPANSION_MODE_ORDER) {
    const state = modeState[mode];
    const hits = hitsByMode[mode];
    expandedByMode[mode] = state.run
      ? await expandModeHits(mode, state.idx, hits)
      : { hits, contextHits: [] };
  }
  return expandedByMode;
}

/**
 * Persist retrieval hits into the query cache when the active cache policy
 * requests write-through for this session.
 *
 * @param {object} input
 * @returns {Promise<{cacheData:any,cacheShouldPersist:boolean}>}
 */
async function persistSessionQueryCache({
  queryCacheEnabled,
  cacheKey,
  cacheHit,
  cacheData,
  queryCachePath,
  cacheShouldPersist,
  queryCacheTtlMs,
  cacheSignature,
  query,
  backendLabel,
  hitsByMode,
  executionOutcomes,
  queryCacheMaxEntries,
  signal = null
}) {
  return persistSearchSession({
    queryCacheEnabled,
    cacheKey,
    cacheHit,
    cacheData,
    queryCachePath,
    cacheShouldPersist,
    queryCacheTtlMs,
    cacheSignature,
    query,
    backendLabel,
    proseHits: hitsByMode.prose,
    extractedProseHits: hitsByMode['extracted-prose'],
    codeHits: hitsByMode.code,
    recordHits: hitsByMode.records,
    executionOutcomes,
    queryCacheMaxEntries,
    signal
  });
}

/**
 * Execute one retrieval session, including query cache lookup, per-mode search,
 * context expansion, and telemetry payload assembly.
 *
 * Key invariants:
 * - Cache keys must include query-shaping knobs (including sqlite FTS variant
 *   flags) so option toggles never reuse stale hits.
 * - `sqliteHasDb` is propagated to the pipeline to allow per-mode SQLite
 *   availability checks (for example extracted-prose may be file-backed while
 *   code/prose remain SQLite-backed).
 *
 * @param {object} input
 * @param {string} input.query
 * @param {'default'|'code'|'prose'|'extracted-prose'|'records'} input.searchMode
 * @param {boolean} input.queryCacheEnabled
 * @param {boolean} input.annActive
 * @param {string} [input.resolvedDenseVectorMode]
 * @param {object|null} [input.indexSignaturePayload]
 * @param {(mode:string)=>boolean} [input.sqliteHasDb]
 * @returns {Promise<object>}
 */
export async function runSearchSession({
  effectivePlanIdentity = null,
  filterOnly = false,
  filterCursor = null,
  rootDir,
  userConfig,
  metricsDir,
  queryCacheDir,
  query,
  searchMode,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  commentsEnabled,
  extractedProseLoaded,
  topN,
  useSqlite,
  annEnabled,
  annActive,
  annBackend,
  lancedbConfig,
  vectorExtension,
  vectorAnnEnabled,
  vectorAnnState,
  vectorAnnUsed,
  hnswConfig,
  hnswAnnState,
  hnswAnnUsed,
  lanceAnnState,
  lanceAnnUsed,
  sqliteFtsRequested,
  sqliteFtsNormalize,
  sqliteFtsProfile,
  sqliteFtsWeights,
  sqliteFtsTrigram,
  sqliteFtsStemming,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  bm25K1,
  bm25B,
  fieldWeights,
  postingsConfig,
  queryTokens,
  queryAst,
  phraseNgramSet,
  phraseRange,
  symbolBoost,
  relationBoost,
  annCandidateCap,
  annDiscovery,
  annCandidateMinDocCount,
  annCandidateMaxDocCount,
  maxCandidates,
  filters,
  filtersActive,
  filterPredicates,
  explain,
  scoreBlend,
  rrf,
  graphRankingConfig,
  minhashMaxDocs,
  sparseBackend,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite,
  sqliteHasFts,
  sqliteHasTable,
  sqliteHasDb,
  profilePolicyByMode = null,
  profileWarnings = [],
  idxProse,
  idxExtractedProse,
  idxCode,
  idxRecords,
  modelConfig,
  modelIds,
  embeddingProvider,
  embeddingOnnx,
  embeddingQueryText,
  useStubEmbeddings,
  contextExpansionEnabled,
  contextExpansionOptions,
  contextExpansionRespectFilters,
  cacheFilters,
  queryCacheEnabled,
  queryCacheMaxEntries,
  queryCacheTtlMs,
  queryCacheStrategy,
  queryCachePrewarm,
  queryCachePrewarmMaxEntries,
  queryCacheMemoryFreshMs,
  sqliteTailLatencyTuning,
  sqliteFtsOverfetch,
  preferMemoryBackendOnCacheHit,
  backendLabel,
  resolvedDenseVectorMode,
  indexSignaturePayload = null,
  intentInfo,
  asOfContext = null,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false,
  signal,
  stageTracker
}) {
  const filterEnumeration = filterOnly ? createFilterEnumeration({
    cursor: filterCursor,
    filters: cacheFilters,
    modes: [runCode && 'code', runProse && 'prose', runExtractedProse && 'extracted-prose', runRecords && 'records'].filter(Boolean),
    generation: indexSignaturePayload || { asOfContext, indexDirByMode },
    cacheDir: resolveRetrievalCacheDir({ queryCacheDir, metricsDir })
  }) : null;
  if (filterEnumeration?.modifiedAfter != null) {
    filters = { ...filters, modifiedAfter: filterEnumeration.modifiedAfter };
    filterPredicates = compileFilterPredicates(filters);
  }
  if (filterOnly) {
    queryCacheEnabled = false;
    annActive = false;
    contextExpansionEnabled = false;
  }
  const chunkAuthorCache = resolveChunkAuthorCacheEvidence([
    ...(runCode ? [['code', idxCode]] : []), ...(runProse ? [['prose', idxProse]] : []),
    ...(runExtractedProse ? [['extracted-prose', idxExtractedProse]] : []), ...(runRecords ? [['records', idxRecords]] : [])
  ]);
  if (!chunkAuthorCache.qualified) queryCacheEnabled = false;
  const resolvedDenseMode = normalizeDenseVectorMode(resolvedDenseVectorMode, 'merged');
  enforceSqliteAnnDenseModeCompatibility({
    resolvedDenseMode,
    vectorAnnEnabled,
    vectorAnnState
  });

  /**
   * Raise a cancellation error that is normalized to shared error-code shape.
   *
   * @returns {void}
   */
  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    const error = new Error('Search cancelled.');
    error.code = ERROR_CODES.CANCELLED;
    error.cancelled = true;
    throw error;
  };
  throwIfAborted();
  const annAdaptiveProviders = userConfig?.retrieval?.ann?.adaptiveProviders !== false;
  const sqliteFtsRouting = resolveSqliteFtsRoutingByMode({
    useSqlite,
    sqliteFtsRequested,
    sqliteFtsExplicit: backendLabel === 'sqlite-fts',
    runCode,
    runProse,
    runExtractedProse,
    runRecords
  });
  const sqliteFtsVariantConfig = {
    explicitTrigram: sqliteFtsTrigram === true,
    stemming: sqliteFtsStemming === true,
    substringMode: intentInfo?.type === 'path'
  };
  const searchPipeline = createSearchPipeline({
    filterEnumeration,
    useSqlite,
    sqliteFtsRequested,
    sqliteFtsRoutingByMode: sqliteFtsRouting,
    sqliteFtsVariantConfig,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    sqliteTailLatencyTuning,
    sqliteFtsOverfetch,
    query,
    bm25K1,
    bm25B,
    fieldWeights,
    postingsConfig,
    queryTokens,
    queryAst,
    phraseNgramSet,
    phraseRange,
    symbolBoost,
    relationBoost,
    annCandidateCap,
    annDiscovery,
    annCandidateMinDocCount,
    annCandidateMaxDocCount,
    maxCandidates,
    filters,
    filtersActive,
    filterPredicates,
    explain,
    topN,
    annEnabled: annActive,
    annBackend,
    annAdaptiveProviders,
    scoreBlend,
    rrf,
    graphRankingConfig,
    stageTracker,
    minhashMaxDocs,
    sparseBackend,
    vectorAnnState,
    vectorAnnUsed,
    hnswAnnState,
    hnswAnnUsed,
    lanceAnnState,
    lanceAnnUsed,
    lancedbConfig,
    buildCandidateSetSqlite,
    getTokenIndexForQuery,
    rankSqliteFts,
    rankVectorAnnSqlite,
    sqliteHasFts,
    sqliteHasTable,
    sqliteHasDb,
    profilePolicyByMode,
    signal
  });
  throwIfAborted();

  let {
    cacheStrategy,
    embeddingInputFormattingByMode,
    queryCachePath,
    cacheHit,
    cacheKey,
    cacheSignature,
    cacheData,
    cachedPayload,
    cacheShouldPersist,
    cacheHotPathHit
  } = await resolveSessionCacheState({
    queryCachePolicyInput: {
      queryCacheStrategy,
      preferMemoryBackendOnCacheHit,
      queryCachePrewarm,
      queryCachePrewarmMaxEntries,
      queryCacheMemoryFreshMs,
      sqliteFtsOverfetch
    },
    embeddingInputFormattingInput: {
      idxCode,
      idxProse,
      idxExtractedProse,
      idxRecords
    },
    cacheLookupInput: {
      effectivePlanIdentity,
      chunkAuthorEvidence: chunkAuthorCache.evidence,
      queryCacheEnabled,
      queryCacheDir,
      metricsDir,
      useSqlite,
      backendLabel,
      sqliteCodePath,
      sqliteProsePath,
      sqliteExtractedProsePath,
      runCode,
      runProse,
      runRecords,
      runExtractedProse,
      extractedProseLoaded,
      commentsEnabled,
      rootDir,
      userConfig,
      indexDirByMode,
      indexBaseRootByMode,
      explicitRef,
      indexSignaturePayload,
      asOfContext,
      query,
      searchMode,
      topN,
      sqliteFtsRequested,
      annActive,
      annBackend,
      vectorExtension,
      vectorAnnEnabled,
      annAdaptiveProviders,
      relationBoost,
      annCandidateCap,
      annDiscovery,
      annCandidateMinDocCount,
      annCandidateMaxDocCount,
      bm25K1,
      bm25B,
      scoreBlend,
      rrf,
      fieldWeights,
      symbolBoost,
      resolvedDenseVectorMode,
      intentInfo,
      minhashMaxDocs,
      maxCandidates,
      sparseBackend,
      explain,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      sqliteFtsTrigram,
      sqliteFtsStemming,
      sqliteTailLatencyTuning,
      modelIds,
      embeddingProvider,
      embeddingOnnx,
      contextExpansionEnabled,
      contextExpansionOptions,
      contextExpansionRespectFilters,
      cacheFilters,
      graphRankingConfig,
      queryCacheTtlMs,
      queryCacheMaxEntries,
      signal
    }
  });
  if (queryCacheEnabled) {
    incCacheEvent({ cache: 'query', result: cacheHit ? 'hit' : 'miss' });
  }
  throwIfAborted();

  const modeState = await resolveModeAnnMetadata({
    modeState: createModeState({
      runCode,
      runProse,
      runExtractedProse,
      runRecords,
      idxCode,
      idxProse,
      idxExtractedProse,
      idxRecords,
      modelIds,
      embeddingInputFormattingByMode
    }),
    vectorAnnState,
    hnswAnnState,
    lanceAnnState,
    probeLazyDense: !cacheHit && annActive
  });
  const needsEmbedding = !cacheHit && annActive && EMBEDDING_MODE_ORDER.some((mode) => {
    const state = modeState[mode];
    return state.run && state.hasAnn;
  });
  const queryWork = stageTracker?.enabled ? createRetrievalWorkObservation() : null;
  const getEmbeddingForModel = createEmbeddingResolver({
    throwIfAborted,
    embeddingQueryText,
    modelConfig,
    useStubEmbeddings,
    embeddingProvider,
    embeddingOnnx,
    rootDir,
    generation: indexSignaturePayload || indexDirByMode,
    work: queryWork
  });
  const queryEmbeddingsByMode = await resolveQueryEmbeddingsByMode({
    modeState,
    needsEmbedding,
    getEmbeddingForModel
  });
  throwIfAborted();

  const cachedHits = cacheHit ? resolveCachedHits(cachedPayload) : null;
  const { proseHits, extractedProseHits, codeHits, recordHits } = cachedHits || await runSearchByMode({
    searchPipeline,
    runProse,
    runExtractedProse,
    runCode,
    runRecords,
    idxProse,
    idxExtractedProse,
    idxCode,
    idxRecords,
    queryEmbeddingProse: queryEmbeddingsByMode.prose,
    queryEmbeddingExtractedProse: queryEmbeddingsByMode['extracted-prose'],
    queryEmbeddingCode: queryEmbeddingsByMode.code,
    queryEmbeddingRecords: queryEmbeddingsByMode.records,
    signal
  });
  throwIfAborted();

  const joinComments = commentsEnabled && runCode && extractedProseLoaded;

  const {
    contextExpansionStats,
    expandModeHits
  } = createModeExpander({
    signal,
    contextCacheDir: resolveRetrievalCacheDir({ queryCacheDir, metricsDir }),
    contextExpansionEnabled,
    contextExpansionOptions,
    contextExpansionRespectFilters,
    filters,
    filtersActive,
    filterPredicates,
    explain
  });
  const hitsByMode = {
    prose: proseHits,
    'extracted-prose': extractedProseHits,
    code: codeHits,
    records: recordHits
  };
  const executionOutcomes = cacheHit ? cachedPayload.executionOutcomes
    : Object.fromEntries(EMBEDDING_MODE_ORDER.filter(mode => modeState[mode].run).map(mode => [mode,
      hitsByMode[mode].executionOutcome || createRetrievalExecutionOutcome({ mode, unrecorded: true,
        chunkAuthorCoverage: modeState[mode].idx?.chunkAuthorCoverage })]));
  const expandedByMode = await expandSessionHitsByMode({
    expandModeHits,
    modeState,
    hitsByMode
  });
  const proseExpanded = expandedByMode.prose;
  const extractedProseExpanded = expandedByMode['extracted-prose'];
  const codeExpanded = expandedByMode.code;
  const recordExpanded = expandedByMode.records;

  const commentLookup = buildCommentLookup({
    joinComments: joinComments && needsCommentExcerpts(codeExpanded.hits),
    extractedChunkMeta: idxExtractedProse?.chunkMeta || null
  });
  attachCommentExcerpts({
    hits: codeExpanded.hits,
    commentLookup
  });
  throwIfAborted();

  const annBackendUsed = resolveAnnBackendUsed({
    vectorAnnEnabled,
    vectorAnnUsed,
    hnswAnnUsed,
    lanceAnnUsed
  });
  ({ cacheData, cacheShouldPersist } = await persistSessionQueryCache({
    queryCacheEnabled,
    cacheKey,
    cacheHit,
    cacheData,
    queryCachePath,
    cacheShouldPersist,
    queryCacheTtlMs,
    cacheSignature,
    query,
    backendLabel,
    hitsByMode,
    executionOutcomes,
    queryCacheMaxEntries,
    signal
  }));

  return {
    filterEnumeration,
    proseHits,
    extractedProseHits,
    codeHits,
    recordHits,
    proseExpanded,
    extractedProseExpanded,
    codeExpanded,
    recordExpanded,
    contextExpansionStats,
    executionOutcomes,
    work: queryWork,
    annBackend: annBackendUsed,
    profile: {
      byMode: profilePolicyByMode || null,
      warnings: Array.isArray(profileWarnings) ? profileWarnings : []
    },
    cache: {
      enabled: queryCacheEnabled,
      hit: cacheHit,
      key: cacheKey,
      strategy: cacheStrategy,
      memoryHotPath: cacheHotPathHit
    },
    routingPolicy: sqliteFtsRouting
  };
}
