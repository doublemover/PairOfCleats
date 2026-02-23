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
  const resolvedDenseMode = typeof resolvedDenseVectorMode === 'string'
    ? resolvedDenseVectorMode.trim().toLowerCase()
    : 'merged';
  const sqliteVectorAllowed = resolvedDenseMode === 'merged';
  if (!sqliteVectorAllowed && vectorAnnEnabled && vectorAnnState) {
    const hasSqliteAnn = Object.values(vectorAnnState)
      .some((entry) => entry?.available === true);
    if (hasSqliteAnn) {
      console.warn(
        `[ann] sqlite-vec only supports merged vectors; disabling sqlite ANN for denseVectorMode=${resolvedDenseMode}.`
      );
    }
    for (const entry of Object.values(vectorAnnState)) {
      if (entry) entry.available = false;
    }
  }
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

  const {
    cacheStrategy,
    cachePrewarmEnabled,
    cachePrewarmLimit,
    cacheMemoryFreshMs,
    sqliteFtsOverfetchCacheKey
  } = resolveQueryCachePolicy({
    queryCacheStrategy,
    preferMemoryBackendOnCacheHit,
    queryCachePrewarm,
    queryCachePrewarmMaxEntries,
    queryCacheMemoryFreshMs,
    sqliteFtsOverfetch
  });
  const embeddingInputFormattingByMode = resolveEmbeddingInputFormattingByMode({
    idxCode,
    idxProse,
    idxExtractedProse,
    idxRecords
  });
  let {
    queryCachePath,
    cacheHit,
    cacheKey,
    cacheSignature,
    cacheData,
    cachedPayload,
    cacheShouldPersist,
    cacheHotPathHit
  } = await resolveQueryCacheLookup({
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
    sqliteFtsOverfetchCacheKey,
    modelIds,
    embeddingProvider,
    embeddingOnnx,
    embeddingInputFormattingByMode,
    contextExpansionEnabled,
    contextExpansionOptions,
    contextExpansionRespectFilters,
    cacheFilters,
    graphRankingConfig,
    queryCacheTtlMs,
    queryCacheMaxEntries,
    cacheStrategy,
    cachePrewarmEnabled,
    cachePrewarmLimit,
    cacheMemoryFreshMs
  });
  if (queryCacheEnabled) {
    incCacheEvent({ cache: 'query', result: cacheHit ? 'hit' : 'miss' });
  }
  throwIfAborted();

  const hasAnn = (mode, idx) => Boolean(
    idx?.denseVec?.vectors?.length
    || typeof idx?.loadDenseVectors === 'function'
    || vectorAnnState?.[mode]?.available
    || hnswAnnState?.[mode]?.available
    || lanceAnnState?.[mode]?.available
  );
  const resolveEmbeddingNormalize = (idx) => (
    idx?.state?.embeddings?.embeddingIdentity?.normalize !== false
  );
  const needsEmbedding = !cacheHit && annActive && (
    (runProse && hasAnn('prose', idxProse))
    || (runCode && hasAnn('code', idxCode))
    || (runExtractedProse && hasAnn('extracted-prose', idxExtractedProse))
    || (runRecords && hasAnn('records', idxRecords))
  );
  const resolveEmbeddingDims = (mode, idx) => (
    idx?.denseVec?.dims
    ?? idx?.hnsw?.meta?.dims
    ?? lanceAnnState?.[mode]?.dims
    ?? null
  );
  const getEmbeddingForModel = createEmbeddingResolver({
    throwIfAborted,
    embeddingQueryText,
    modelConfig,
    useStubEmbeddings,
    embeddingProvider,
    embeddingOnnx,
    rootDir
  });
  const queryEmbeddingCode = needsEmbedding && runCode && hasAnn('code', idxCode)
    ? await getEmbeddingForModel(
      modelIds.code,
      resolveEmbeddingDims('code', idxCode),
      resolveEmbeddingNormalize(idxCode),
      embeddingInputFormattingByMode.code
    )
    : null;
  const queryEmbeddingProse = needsEmbedding && runProse && hasAnn('prose', idxProse)
    ? await getEmbeddingForModel(
      modelIds.prose,
      resolveEmbeddingDims('prose', idxProse),
      resolveEmbeddingNormalize(idxProse),
      embeddingInputFormattingByMode.prose
    )
    : null;
  const queryEmbeddingExtractedProse = needsEmbedding && runExtractedProse && hasAnn('extracted-prose', idxExtractedProse)
    ? await getEmbeddingForModel(
      modelIds.extractedProse,
      resolveEmbeddingDims('extracted-prose', idxExtractedProse),
      resolveEmbeddingNormalize(idxExtractedProse),
      embeddingInputFormattingByMode.extractedProse
    )
    : null;
  const queryEmbeddingRecords = needsEmbedding && runRecords && hasAnn('records', idxRecords)
    ? await getEmbeddingForModel(
      modelIds.records,
      resolveEmbeddingDims('records', idxRecords),
      resolveEmbeddingNormalize(idxRecords),
      embeddingInputFormattingByMode.records
    )
    : null;
  throwIfAborted();

  const cachedHits = cacheHit && cachedPayload
    ? {
      proseHits: cachedPayload.prose || [],
      extractedProseHits: cachedPayload.extractedProse || [],
      codeHits: cachedPayload.code || [],
      recordHits: cachedPayload.records || []
    }
    : null;
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
    queryEmbeddingProse,
    queryEmbeddingExtractedProse,
    queryEmbeddingCode,
    queryEmbeddingRecords,
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
        const start = Number(comment.start);
        const end = Number(comment.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const key = `${chunk.file}:${start}:${end}`;
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
        const start = Number(ref?.start);
        const end = Number(ref?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const matches = commentLookup.get(`${hit.file}:${start}:${end}`);
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
  const proseExpanded = runProse
    ? await expandModeHits('prose', idxProse, proseHits)
    : { hits: proseHits, contextHits: [] };
  const extractedProseExpanded = runExtractedProse
    ? await expandModeHits('extracted-prose', idxExtractedProse, extractedProseHits)
    : { hits: extractedProseHits, contextHits: [] };
  const codeExpanded = runCode
    ? await expandModeHits('code', idxCode, codeHits)
    : { hits: codeHits, contextHits: [] };
  const recordExpanded = runRecords
    ? await expandModeHits('records', idxRecords, recordHits)
    : { hits: recordHits, contextHits: [] };

  attachCommentExcerpts(codeExpanded.hits);
  throwIfAborted();

  const annBackendUsed = resolveAnnBackendUsed({
    vectorAnnEnabled,
    vectorAnnUsed,
    hnswAnnUsed,
    lanceAnnUsed
  });
  ({ cacheData, cacheShouldPersist } = await persistSearchSession({
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
    proseHits,
    extractedProseHits,
    codeHits,
    recordHits,
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
