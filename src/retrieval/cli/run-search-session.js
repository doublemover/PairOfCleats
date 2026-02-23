import { incCacheEvent } from '../../shared/metrics.js';
import { ERROR_CODES } from '../../shared/error-codes.js';
import { createSearchPipeline } from '../pipeline.js';
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

const normalizeDenseVectorMode = (value) => (
  typeof value === 'string'
    ? value.trim().toLowerCase()
    : 'merged'
);

const normalizeFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const buildCommentLookupKey = (file, start, end) => `${file}:${start}:${end}`;

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

function resolveModeAnnMetadata({
  modeState,
  vectorAnnState,
  hnswAnnState,
  lanceAnnState
}) {
  for (const mode of EMBEDDING_MODE_ORDER) {
    const state = modeState[mode];
    const idx = state.idx;
    state.hasAnn = Boolean(
      idx?.denseVec?.vectors?.length
      || typeof idx?.loadDenseVectors === 'function'
      || vectorAnnState?.[mode]?.available
      || hnswAnnState?.[mode]?.available
      || lanceAnnState?.[mode]?.available
    );
    state.embeddingDims = (
      idx?.denseVec?.dims
      ?? idx?.hnsw?.meta?.dims
      ?? lanceAnnState?.[mode]?.dims
      ?? null
    );
    state.embeddingNormalize = idx?.state?.embeddings?.embeddingIdentity?.normalize !== false;
  }
  return modeState;
}

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
    embeddingsByMode[mode] = await getEmbeddingForModel(
      state.modelId,
      state.embeddingDims,
      state.embeddingNormalize,
      state.inputFormatting
    );
  }
  return embeddingsByMode;
}

function resolveCachedHits(cachedPayload) {
  if (!cachedPayload) return null;
  return {
    proseHits: cachedPayload.prose || [],
    extractedProseHits: cachedPayload.extractedProse || [],
    codeHits: cachedPayload.code || [],
    recordHits: cachedPayload.records || []
  };
}

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
  queryCacheMaxEntries
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
    queryCacheMaxEntries
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
 * @param {(mode:string)=>boolean} [input.sqliteHasDb]
 * @returns {Promise<object>}
 */
export async function runSearchSession({
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
  intentInfo,
  asOfContext = null,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false,
  signal,
  stageTracker
}) {
  const resolvedDenseMode = normalizeDenseVectorMode(resolvedDenseVectorMode);
  enforceSqliteAnnDenseModeCompatibility({
    resolvedDenseMode,
    vectorAnnEnabled,
    vectorAnnState
  });
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
      queryCacheMaxEntries
    }
  });
  if (queryCacheEnabled) {
    incCacheEvent({ cache: 'query', result: cacheHit ? 'hit' : 'miss' });
  }
  throwIfAborted();

  const modeState = resolveModeAnnMetadata({
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
    lanceAnnState
  });
  const needsEmbedding = !cacheHit && annActive && EMBEDDING_MODE_ORDER.some((mode) => {
    const state = modeState[mode];
    return state.run && state.hasAnn;
  });
  const getEmbeddingForModel = createEmbeddingResolver({
    throwIfAborted,
    embeddingQueryText,
    modelConfig,
    useStubEmbeddings,
    embeddingProvider,
    embeddingOnnx,
    rootDir
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
  const commentLookup = (() => {
    if (!joinComments || !idxExtractedProse?.chunkMeta?.length) return null;
    const map = new Map();
    for (const chunk of idxExtractedProse.chunkMeta) {
      if (!chunk?.file) continue;
      const comments = chunk.docmeta?.comments;
      if (!Array.isArray(comments) || !comments.length) continue;
      for (const comment of comments) {
        if (!comment || !comment.text) continue;
        const start = normalizeFiniteNumber(comment.start);
        const end = normalizeFiniteNumber(comment.end);
        if (start === null || end === null) continue;
        const key = buildCommentLookupKey(chunk.file, start, end);
        const list = map.get(key) || [];
        list.push(comment);
        map.set(key, list);
      }
    }
    return map.size ? map : null;
  })();

  const attachCommentExcerpts = (hits) => {
    if (!commentLookup || !Array.isArray(hits) || !hits.length) return;
    for (const hit of hits) {
      if (!hit?.file) continue;
      const docmeta = hit.docmeta && typeof hit.docmeta === 'object' ? hit.docmeta : {};
      if (docmeta.commentExcerpts || docmeta.commentExcerpt) continue;
      const refs = docmeta.commentRefs;
      if (!Array.isArray(refs) || !refs.length) continue;
      const excerpts = [];
      for (const ref of refs) {
        const start = normalizeFiniteNumber(ref?.start);
        const end = normalizeFiniteNumber(ref?.end);
        if (start === null || end === null) continue;
        const matches = commentLookup.get(buildCommentLookupKey(hit.file, start, end));
        if (!matches?.length) continue;
        for (const match of matches) {
          if (!match?.text) continue;
          excerpts.push({
            type: ref?.type || match.type || null,
            style: ref?.style || match.style || null,
            languageId: ref?.languageId || match.languageId || null,
            start,
            end,
            startLine: ref?.startLine ?? match.startLine ?? null,
            endLine: ref?.endLine ?? match.endLine ?? null,
            text: match.text,
            truncated: match.truncated || false,
            indexed: match.indexed !== false
          });
        }
      }
      if (!excerpts.length) continue;
      const unique = [];
      const seen = new Set();
      for (const entry of excerpts) {
        const key = `${entry.start}:${entry.end}:${entry.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(entry);
      }
      if (!unique.length) continue;
      const limited = unique.slice(0, 3);
      hit.docmeta = {
        ...docmeta,
        commentExcerpts: limited,
        commentExcerpt: limited[0]?.text || null
      };
    }
  };

  attachCommentExcerpts(codeHits);

  const {
    contextExpansionStats,
    expandModeHits
  } = createModeExpander({
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
  const expandedByMode = await expandSessionHitsByMode({
    expandModeHits,
    modeState,
    hitsByMode
  });
  const proseExpanded = expandedByMode.prose;
  const extractedProseExpanded = expandedByMode['extracted-prose'];
  const codeExpanded = expandedByMode.code;
  const recordExpanded = expandedByMode.records;

  attachCommentExcerpts(codeExpanded.hits);
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
    queryCacheMaxEntries
  }));

  return {
    proseHits,
    extractedProseHits,
    codeHits,
    recordHits,
    proseExpanded,
    extractedProseExpanded,
    codeExpanded,
    recordExpanded,
    contextExpansionStats,
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
