import { filterChunkIds } from './output.js';
import { bitmapHas, bitmapToSet, getBitmapSize } from './bitmap.js';
import { hasActiveFilters } from './filters.js';
import { rankBM25, rankBM25Fields, rankMinhash } from './rankers.js';
import { createJsBm25Provider } from './sparse/providers/js-bm25.js';
import { createSqliteFtsProvider } from './sparse/providers/sqlite-fts.js';
import { createTantivyProvider } from './sparse/providers/tantivy.js';
import { createDenseAnnProvider } from './ann/providers/dense.js';
import { createHnswAnnProvider } from './ann/providers/hnsw.js';
import { createLanceDbAnnProvider } from './ann/providers/lancedb.js';
import { createSqliteVectorAnnProvider } from './ann/providers/sqlite-vec.js';
import { ANN_PROVIDER_IDS } from './ann/types.js';
import { resolveAnnOrder } from './ann/normalize-backend.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { createCandidateSetBuilder } from './pipeline/candidates.js';
import { fuseRankedHits } from './pipeline/fusion.js';
import { createQueryAstHelpers } from './pipeline/query-ast.js';
import { createCandidatePool } from './pipeline/candidate-pool.js';
import { createScoreBufferPool } from './pipeline/score-buffer.js';
import { compileFtsMatchQuery } from './fts-query.js';
import { resolveSparseRequiredTables, RETRIEVAL_SPARSE_UNAVAILABLE_CODE } from './sparse/requirements.js';
import { createProviderRuntime } from './pipeline/provider-runtime.js';
import { resolveFileRelations } from './pipeline/relations.js';
import { runCandidateStage } from './pipeline/candidate-stage.js';
import { runAnnStage } from './pipeline/ann-stage.js';
import { runRankStage } from './pipeline/rank-stage.js';
import {
  FTS_UNAVAILABLE_CODE,
  MAX_POOL_ENTRIES
} from './pipeline/constants.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../contracts/index-profile.js';

const normalizeTokenList = (value) => (
  Array.isArray(value)
    ? value
      .map((token) => (typeof token === 'string' ? token.trim() : ''))
      .filter(Boolean)
    : []
);

const resolveTokenStats = (queryTokens) => {
  const tokens = normalizeTokenList(queryTokens);
  const uniqueCount = new Set(tokens).size;
  let charCount = 0;
  let symbolCount = 0;
  for (const token of tokens) {
    for (const ch of token) {
      charCount += 1;
      if (/[^0-9A-Za-z_]/.test(ch)) symbolCount += 1;
    }
  }
  const diversity = tokens.length > 0 ? uniqueCount / tokens.length : 0;
  const symbolRatio = charCount > 0 ? symbolCount / charCount : 0;
  return {
    tokens,
    tokenCount: tokens.length,
    uniqueCount,
    diversity,
    symbolRatio
  };
};

const resolveSparseConfidence = ({ sparseHits, searchTopN }) => {
  const hits = Array.isArray(sparseHits) ? sparseHits : [];
  const topScore = Number(hits[0]?.score);
  const secondScore = Number(hits[1]?.score);
  const hasScoreGap = Number.isFinite(topScore)
    && topScore > 0
    && Number.isFinite(secondScore)
    && secondScore >= 0
    && (topScore - secondScore) / topScore >= 0.2;
  return {
    hitCount: hits.length,
    hasScoreGap,
    high: hits.length >= Math.max(searchTopN * 2, 8) && hasScoreGap,
    weak: hits.length < Math.max(3, Math.ceil(searchTopN * 0.8))
  };
};

export const resolveAdaptiveRerankBudget = ({
  searchTopN = 10,
  baseTopkSlack = 8,
  queryTokens = [],
  sparseHits = [],
  annHits = []
} = {}) => {
  const safeTopN = Math.max(1, Math.floor(Number(searchTopN) || 1));
  const baseSlack = Math.max(0, Math.floor(Number(baseTopkSlack) || 0));
  const tokenStats = resolveTokenStats(queryTokens);
  const sparseConfidence = resolveSparseConfidence({
    sparseHits,
    searchTopN: safeTopN
  });
  const annHitCount = Array.isArray(annHits) ? annHits.length : 0;
  const lowEntropy = tokenStats.tokenCount <= 2 && tokenStats.symbolRatio < 0.25;
  const highEntropy = tokenStats.tokenCount >= 7
    || tokenStats.diversity >= 0.9
    || tokenStats.symbolRatio >= 0.35;
  let topkSlack = baseSlack;
  let reason = 'baseline';

  if (sparseConfidence.high && lowEntropy) {
    topkSlack = Math.max(4, Math.ceil(safeTopN * 0.25));
    reason = 'high_confidence_low_entropy';
  } else if (highEntropy || sparseConfidence.weak || annHitCount >= safeTopN * 2) {
    topkSlack = Math.max(baseSlack, Math.ceil(safeTopN * 0.9));
    reason = 'high_entropy_or_low_confidence';
  } else if (tokenStats.tokenCount <= 3 && tokenStats.symbolRatio < 0.3) {
    topkSlack = Math.max(6, Math.ceil(safeTopN * 0.35));
    reason = 'moderate_confidence_short_query';
  }

  topkSlack = Math.max(0, Math.min(200, Math.floor(topkSlack)));
  return {
    topkSlack,
    rerankCap: safeTopN + topkSlack,
    reason,
    tokenStats: {
      tokenCount: tokenStats.tokenCount,
      uniqueCount: tokenStats.uniqueCount,
      diversity: tokenStats.diversity,
      symbolRatio: tokenStats.symbolRatio
    },
    sparseConfidence: {
      hitCount: sparseConfidence.hitCount,
      hasScoreGap: sparseConfidence.hasScoreGap,
      high: sparseConfidence.high,
      weak: sparseConfidence.weak
    },
    annHitCount
  };
};

/**
 * Create a search pipeline runner bound to a shared context.
 * @param {object} context
 * @param {(mode:string)=>boolean} [context.sqliteHasDb]
 * Optional per-mode SQLite availability probe. When omitted, extracted-prose
 * follows legacy behavior and is treated as SQLite-backed whenever
 * `useSqlite=true`.
 * @returns {(idx:object, mode:'code'|'prose'|'records'|'extracted-prose', queryEmbedding:number[]|null)=>Promise<Array<object>>}
 */
export function createSearchPipeline(context) {
  const {
    useSqlite,
    sqliteFtsRequested,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    sqliteTailLatencyTuning,
    sqliteFtsOverfetch,
    bm25K1,
    bm25B,
    fieldWeights,
    postingsConfig,
    query,
    queryTokens,
    queryAst,
    phraseNgramSet,
    phraseRange,
    explain,
    symbolBoost,
    relationBoost,
    filters,
    filtersActive,
    filterPredicates,
    topN,
    maxCandidates,
    annEnabled,
    annBackend,
    annAdaptiveProviders,
    scoreBlend,
    annCandidateCap,
    annCandidateMinDocCount,
    annCandidateMaxDocCount,
    minhashMaxDocs,
    sparseBackend,
    sqliteFtsRoutingByMode,
    sqliteFtsVariantConfig,
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
    signal,
    rrf,
    graphRankingConfig,
    stageTracker,
    candidatePool: candidatePoolInput,
    scoreBufferPool: scoreBufferPoolInput,
    createAnnProviders: createAnnProvidersInput
  } = context;
  const blendEnabled = scoreBlend?.enabled === true;
  const blendSparseWeight = Number.isFinite(Number(scoreBlend?.sparseWeight))
    ? Number(scoreBlend.sparseWeight)
    : 1;
  const blendAnnWeight = Number.isFinite(Number(scoreBlend?.annWeight))
    ? Number(scoreBlend.annWeight)
    : 1;
  const symbolBoostEnabled = symbolBoost?.enabled !== false;
  const symbolBoostDefinitionWeight = Number.isFinite(Number(symbolBoost?.definitionWeight))
    ? Number(symbolBoost.definitionWeight)
    : 1.15;
  const symbolBoostExportWeight = Number.isFinite(
    Number(symbolBoost?.exportWeight)
  )
    ? Number(symbolBoost.exportWeight)
    : 1.1;
  const relationBoostEnabled = relationBoost?.enabled === true;
  const relationBoostPerCall = Number.isFinite(Number(relationBoost?.perCall))
    ? Number(relationBoost.perCall)
    : 0.25;
  const relationBoostPerUse = Number.isFinite(Number(relationBoost?.perUse))
    ? Number(relationBoost.perUse)
    : 0.1;
  const relationBoostMaxBoost = Number.isFinite(Number(relationBoost?.maxBoost))
    ? Number(relationBoost.maxBoost)
    : 1.5;
  const relationBoostConfig = {
    enabled: relationBoostEnabled,
    perCall: relationBoostPerCall,
    perUse: relationBoostPerUse,
    maxBoost: relationBoostMaxBoost,
    caseTokens: filters?.caseTokens === true,
    caseFile: filters?.caseFile === true
  };
  const annCandidatePolicyConfig = {
    cap: Number.isFinite(Number(annCandidateCap))
      ? Math.max(1, Math.floor(Number(annCandidateCap)))
      : null,
    minDocCount: Number.isFinite(Number(annCandidateMinDocCount))
      ? Math.max(1, Math.floor(Number(annCandidateMinDocCount)))
      : null,
    maxDocCount: Number.isFinite(Number(annCandidateMaxDocCount))
      ? Math.max(1, Math.floor(Number(annCandidateMaxDocCount)))
      : null
  };
  const rrfEnabled = rrf?.enabled !== false;
  const rrfK = Number.isFinite(Number(rrf?.k))
    ? Math.max(1, Number(rrf.k))
    : 60;
  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    const error = createError(ERROR_CODES.CANCELLED, 'Search cancelled.');
    error.cancelled = true;
    throw error;
  };
  const abortIfNeeded = throwIfAborted;
  const minhashLimit = Number.isFinite(Number(minhashMaxDocs))
    && Number(minhashMaxDocs) > 0
    ? Number(minhashMaxDocs)
    : null;
  const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
  const searchTopN = Math.max(1, Number(topN) || 1);
  const expandedTopN = searchTopN * 3;
  const baseTopkSlack = Math.max(8, Math.min(100, Math.ceil(searchTopN * 0.5)));
  const maxCandidateCap = Number.isFinite(Number(maxCandidates)) && Number(maxCandidates) > 0
    ? Math.floor(Number(maxCandidates))
    : null;
  const poolBase = Math.max(searchTopN + baseTopkSlack, expandedTopN * 4, 256);
  const poolCap = Math.min(
    Math.max(poolBase, maxCandidateCap || 0),
    MAX_POOL_ENTRIES
  );
  const candidatePool = candidatePoolInput || createCandidatePool({
    maxSets: 6,
    maxEntries: poolCap
  });
  const scoreBufferPool = scoreBufferPoolInput || createScoreBufferPool({
    maxBuffers: 6,
    maxEntries: poolCap
  });
  const buildCandidateSet = createCandidateSetBuilder({
    useSqlite,
    postingsConfig,
    buildCandidateSetSqlite,
    chargramMaxTokenLength,
    maxCandidates,
    candidatePool
  });
  const fieldWeightsEnabled = fieldWeights
    && Object.values(fieldWeights).some((value) => (
      Number.isFinite(Number(value)) && Number(value) > 0
    ));
  const normalizedSparseBackend = typeof sparseBackend === 'string'
    ? sparseBackend.trim().toLowerCase()
    : 'auto';
  const sqliteFtsProvider = createSqliteFtsProvider({
    rankSqliteFts,
    normalizeScores: sqliteFtsNormalize,
    tailLatencyTuning: sqliteTailLatencyTuning === true,
    overfetch: sqliteFtsOverfetch || null
  });
  const bm25Provider = createJsBm25Provider({ rankBM25, rankBM25Fields });
  const tantivyProvider = createTantivyProvider();
  const sparseRequiredTables = useSqlite
    ? resolveSparseRequiredTables(postingsConfig)
    : [];

  const isDefinitionKind = (kind) => typeof kind === 'string'
    && /Declaration|Definition|Initializer|Deinitializer/.test(kind);

  const isExportedChunk = (chunk) => {
    if (!chunk) return false;
    if (chunk.exported === true || chunk?.meta?.exported === true) return true;
    const kind = chunk.kind || '';
    if (typeof kind === 'string' && kind.includes('Export')) return true;
    const exportsList = Array.isArray(chunk.exports)
      ? chunk.exports
      : (Array.isArray(chunk?.meta?.exports) ? chunk.meta.exports : null);
    if (!exportsList || !chunk.name) return false;
    return exportsList.includes(chunk.name);
  };
  const { matchesQueryAst, getPhraseMatchInfo } = createQueryAstHelpers({
    queryAst,
    phraseNgramSet,
    phraseRange
  });

  const annOrder = resolveAnnOrder(annBackend);
  const explicitAnnBackend = typeof annBackend === 'string'
    && annBackend.trim().length > 0
    && annBackend.trim().toLowerCase() !== 'auto';
  const adaptiveProvidersEnabled = annAdaptiveProviders === true && !explicitAnnBackend;
  const buildAnnProviders = typeof createAnnProvidersInput === 'function'
    ? createAnnProvidersInput
    : () => new Map([
      [
        ANN_PROVIDER_IDS.LANCEDB,
        createLanceDbAnnProvider({ lancedbConfig, lanceAnnState, lanceAnnUsed })
      ],
      [
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        createSqliteVectorAnnProvider({
          rankVectorAnnSqlite,
          vectorAnnState,
          vectorAnnUsed
        })
      ],
      [ANN_PROVIDER_IDS.HNSW, createHnswAnnProvider({ hnswAnnState, hnswAnnUsed })],
      [ANN_PROVIDER_IDS.DENSE, createDenseAnnProvider()]
    ]);
  let annProviders = null;
  const getAnnProviders = () => {
    if (!annProviders) annProviders = buildAnnProviders();
    return annProviders;
  };
  let annWarned = false;
  const warnAnnFallback = (reason) => {
    if (annWarned) return;
    annWarned = true;
    console.warn(
      `[ann] ${reason} Falling back to sparse ranking. ` +
      'Rebuild embeddings or enable a compatible ANN backend to restore vector search.'
    );
  };

  const providerRuntime = createProviderRuntime();
  const sqliteFtsCompilation = compileFtsMatchQuery({
    queryAst,
    queryTokens,
    query,
    explicitTrigram: sqliteFtsVariantConfig?.explicitTrigram === true,
    substringMode: sqliteFtsVariantConfig?.substringMode === true,
    stemmingEnabled: sqliteFtsVariantConfig?.stemming === true
  });
  const filtersEnabled = typeof filtersActive === 'boolean'
    ? filtersActive
    : hasActiveFilters(filters);
  const tableAvailabilityCache = new Map();
  const checkRequiredTables = (mode, tables) => {
    if (!Array.isArray(tables) || !tables.length) return [];
    if (typeof sqliteHasTable !== 'function') return [];
    const missing = [];
    for (const tableName of tables) {
      const cacheKey = `${mode}:${tableName}`;
      let available = tableAvailabilityCache.get(cacheKey);
      if (available == null) {
        available = sqliteHasTable(mode, tableName) === true;
        tableAvailabilityCache.set(cacheKey, available);
      }
      if (!available) missing.push(tableName);
    }
    return missing;
  };

  /**
   * Execute the full retrieval pipeline for one mode, including filtering,
   * sparse/ANN candidate generation, ranking, and optional expansion stages.
   *
   * @param {object} idx
   * @param {'code'|'prose'|'records'|'extracted-prose'} mode
   * @param {number[]|null} queryEmbedding
   * @returns {Promise<Array<object>>}
   */
  return async function runSearch(idx, mode, queryEmbedding) {
    throwIfAborted();
    const meta = idx.chunkMeta;
    const modeProfilePolicy = profilePolicyByMode?.[mode] && typeof profilePolicyByMode[mode] === 'object'
      ? profilePolicyByMode[mode]
      : null;
    const profileId = modeProfilePolicy?.profileId || idx?.state?.profile?.id || null;
    const vectorOnlyProfile = profileId === INDEX_PROFILE_VECTOR_ONLY;
    // extracted-prose may be file-backed even during mixed SQLite runs; gate
    // SQLite-only table checks by actual DB attachment for that mode.
    const sqliteEnabledForMode = useSqlite && (
      mode === 'code'
      || mode === 'prose'
      || (mode === 'extracted-prose'
        && (typeof sqliteHasDb !== 'function' || sqliteHasDb(mode)))
    );
    const sqliteRouteByMode = sqliteFtsRoutingByMode?.byMode?.[mode] || null;
    const sqliteFtsDesiredForMode = sqliteRouteByMode
      ? sqliteRouteByMode.desired === 'fts'
      : sqliteFtsRequested;
    const stageMeta = { mode };
    const runStage = (stage, meta, fn) => {
      const hasMeta = typeof meta === 'object' && typeof fn === 'function';
      const handler = hasMeta ? fn : meta;
      const info = hasMeta ? meta : stageMeta;
      if (hasMeta && !Object.prototype.hasOwnProperty.call(info, 'mode')) {
        info.mode = mode;
      }
      return stageTracker?.spanSync ? stageTracker.spanSync(stage, info, handler) : handler();
    };
    const runStageAsync = (stage, meta, fn) => {
      const hasMeta = typeof meta === 'object' && typeof fn === 'function';
      const handler = hasMeta ? fn : meta;
      const info = hasMeta ? meta : stageMeta;
      if (hasMeta && !Object.prototype.hasOwnProperty.call(info, 'mode')) {
        info.mode = mode;
      }
      return stageTracker?.span ? stageTracker.span(stage, info, handler) : handler();
    };

    const getAllowedSize = (value) => (value ? getBitmapSize(value) : 0);
    const hasAllowedId = (value, id) => bitmapHas(value, id);
    const ensureAllowedSet = (value) => {
      if (!value) return null;
      return value instanceof Set ? value : bitmapToSet(value);
    };

    const poolSnapshot = () => ({
      candidate: { ...candidatePool?.stats },
      score: { ...scoreBufferPool?.stats }
    });
    const poolStatsStart = poolSnapshot();
    const releaseSets = [];
    const releaseBuffers = [];
    const trackReleaseSet = (set) => {
      if (candidatePool?.owns?.(set)) releaseSets.push(set);
    };
    const trackReleaseBuffer = (buffer) => {
      if (scoreBufferPool?.owns?.(buffer)) releaseBuffers.push(buffer);
    };

    try {
      // Filtering
      const filterMetrics = {};
      const filterResult = runStage('filter', filterMetrics, () => {
        if (!filtersEnabled) {
          filterMetrics.counts = {
            filtered: Array.isArray(meta) ? meta.length : 0,
            allowed: null
          };
          return { allowed: null };
        }
        const allowed = filterChunkIds(meta, filters, idx.filterIndex, idx.fileRelations, {
          compiled: filterPredicates,
          preferBitmap: true
        });
        const allowedCount = allowed ? getAllowedSize(allowed) : null;
        const filteredCount = allowed == null ? (Array.isArray(meta) ? meta.length : 0) : allowedCount;
        filterMetrics.counts = {
          filtered: filteredCount ?? 0,
          allowed: allowed ? allowedCount : null,
          bitmap: allowed ? !(allowed instanceof Set) : false
        };
        return { allowed };
      });
      throwIfAborted();
      const allowedIdx = filterResult.allowed;
      const allowedCount = allowedIdx ? getAllowedSize(allowedIdx) : 0;
      if (filtersEnabled && allowedIdx && allowedCount === 0) {
        return [];
      }
      throwIfAborted();

      // Main search: BM25 token match (with optional SQLite FTS first pass)
      const candidateMetrics = {};
      const candidateResult = runStage('candidates', candidateMetrics, () => (
        runCandidateStage({
          idx,
          mode,
          allowedIdx,
          allowedCount,
          filtersEnabled,
          sqliteEnabledForMode,
          sqliteFtsDesiredForMode,
          sqliteFtsCompilation,
          sqliteFtsProvider,
          bm25Provider,
          tantivyProvider,
          normalizedSparseBackend,
          postingsConfig,
          sparseRequiredTables,
          sqliteHasFts,
          checkRequiredTables,
          sqliteRouteByMode,
          profileId,
          modeProfilePolicy,
          vectorOnlyProfile,
          fieldWeightsEnabled,
          queryTokens,
          expandedTopN,
          ensureAllowedSet,
          buildCandidateSet,
          candidatePool,
          trackReleaseSet,
          fieldWeights,
          bm25K1,
          bm25B,
          getTokenIndexForQuery,
          candidateMetrics
        })
      ));
      let { candidates, bmHits, sparseType, sqliteFtsUsed, sqliteFtsDiagnostics } = candidateResult;
      const sqliteFtsUnavailable = Array.isArray(sqliteFtsDiagnostics)
        ? sqliteFtsDiagnostics.find((entry) => entry?.code === FTS_UNAVAILABLE_CODE)
        : null;
      const sparseUnavailable = Array.isArray(sqliteFtsDiagnostics)
        ? sqliteFtsDiagnostics.find((entry) => entry?.code === RETRIEVAL_SPARSE_UNAVAILABLE_CODE)
        : null;
      const sparseFallbackAllowedByPolicy = modeProfilePolicy?.allowSparseFallback === true;
      const annEnabledForMode = annEnabled || (
        sparseFallbackAllowedByPolicy
        && sparseUnavailable
        && sparseType === 'none'
      );
      if (!annEnabledForMode && !vectorOnlyProfile && sparseUnavailable && sparseType === 'none') {
        throw createError(
          ERROR_CODES.CAPABILITY_MISSING,
          'Sparse retrieval backend is unavailable for this query. ' +
            'Rebuild sparse artifacts or enable ANN search.',
          {
            reasonCode: RETRIEVAL_SPARSE_UNAVAILABLE_CODE,
            reason: sparseUnavailable.reason || 'sparse_unavailable',
            mode,
            profileId,
            missingTables: sparseUnavailable.missingTables || null
          }
        );
      }

      const annMetrics = {};
      const annResult = await runStageAsync('ann', annMetrics, async () => (
        runAnnStage({
          idx,
          mode,
          meta,
          queryEmbedding,
          queryTokens,
          searchTopN,
          expandedTopN,
          annEnabledForMode,
          vectorOnlyProfile,
          profileId,
          annOrder,
          adaptiveProvidersEnabled,
          getAnnProviders,
          warnAnnFallback,
          providerRuntime,
          signal,
          candidatePool,
          trackReleaseSet,
          candidates,
          bmHits,
          allowedIdx,
          allowedCount,
          filtersEnabled,
          annCandidatePolicyConfig,
          minhashLimit,
          hasAllowedId,
          ensureAllowedSet,
          bitmapToSet,
          rankMinhash,
          vectorAnnState,
          hnswAnnState,
          lanceAnnState,
          annMetrics
        })
      ));
      candidates = annResult.candidates;
      let { annHits, annSource, annCandidatePolicy } = annResult;
      const rerankBudget = resolveAdaptiveRerankBudget({
        searchTopN,
        baseTopkSlack,
        queryTokens,
        sparseHits: bmHits,
        annHits
      });
      const topkSlack = rerankBudget.topkSlack;

      const fusionBuffer = scoreBufferPool.acquire({
        fields: [
          'idx',
          'score',
          'scoreType',
          'sparseScore',
          'annScore',
          'annSource',
          'sparseType',
          'blendInfo'
        ],
        numericFields: ['idx', 'score'],
        capacity: Math.max(bmHits.length + annHits.length, rerankBudget.rerankCap)
      });
      trackReleaseBuffer(fusionBuffer);
      const fusionResult = runStage('fusion', () => (
        fuseRankedHits({
          bmHits,
          annHits,
          sparseType,
          annSource,
          rrfEnabled,
          rrfK,
          blendEnabled,
          blendSparseWeight,
          blendAnnWeight,
          fieldWeightsEnabled,
          scoreBuffer: fusionBuffer
        })
      ));
      const { scored: fusedScores, useRrf } = fusionResult;

      if (idx.loadChunkMetaByIds) {
        const seen = new Set();
        const missing = [];
        for (const hit of bmHits) {
          const id = hit?.idx;
          if (!Number.isFinite(id) || seen.has(id)) continue;
          seen.add(id);
          if (!meta[id]) missing.push(id);
        }
        for (const hit of annHits) {
          const id = hit?.idx;
          if (!Number.isFinite(id) || seen.has(id)) continue;
          seen.add(id);
          if (!meta[id]) missing.push(id);
        }
        if (missing.length) idx.loadChunkMetaByIds(mode, missing, meta);
      }
      if (signal?.aborted) {
        const error = createError(ERROR_CODES.CANCELLED, 'Search cancelled.');
        error.cancelled = true;
        throw error;
      }

      const rankMetrics = {};
      rankMetrics.rerankBudget = rerankBudget;
      const ranked = runStage('rank', rankMetrics, () => (
        runRankStage({
          idx,
          meta,
          fusedScores,
          useRrf,
          allowedIdx,
          hasAllowedId,
          abortIfNeeded,
          searchTopN,
          topkSlack,
          poolSnapshotStart: poolStatsStart,
          poolSnapshot,
          rankMetrics,
          explain,
          matchesQueryAst,
          getPhraseMatchInfo,
          phraseNgramSet,
          symbolBoostEnabled,
          symbolBoostDefinitionWeight,
          symbolBoostExportWeight,
          isDefinitionKind,
          isExportedChunk,
          relationBoostEnabled,
          relationBoostConfig,
          resolveFileRelations,
          queryTokens,
          graphRankingConfig,
          sqliteFtsNormalize,
          sqliteFtsWeights,
          sqliteFtsProfile,
          sqliteFtsCompilation,
          sqliteFtsUnavailable,
          profileId,
          fieldWeightsEnabled,
          bm25K1,
          bm25B,
          sqliteFtsDesiredForMode,
          annCandidatePolicy,
          blendEnabled
        })
      ));

      return ranked;
    } finally {
      for (const set of releaseSets) {
        candidatePool.release(set);
      }
      for (const buffer of releaseBuffers) {
        scoreBufferPool.release(buffer);
      }
    }
  };
}
