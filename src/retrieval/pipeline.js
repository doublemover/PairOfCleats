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
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { createCandidateSetBuilder } from './pipeline/candidates.js';
import { resolveAnnOrder } from './pipeline/ann-backends.js';
import { fuseRankedHits } from './pipeline/fusion.js';
import { createQueryAstHelpers } from './pipeline/query-ast.js';
import { applyGraphRanking } from './pipeline/graph-ranking.js';
import { createCandidatePool } from './pipeline/candidate-pool.js';
import { createScoreBufferPool } from './pipeline/score-buffer.js';
import { createTopKReducer } from './pipeline/topk.js';

const SQLITE_IN_LIMIT = 900;
const MAX_POOL_ENTRIES = 50000;

const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

/**
 * Create a search pipeline runner bound to a shared context.
 * @param {object} context
 * @returns {(idx:object, mode:'code'|'prose'|'records'|'extracted-prose', queryEmbedding:number[]|null)=>Promise<Array<object>>}
 */
export function createSearchPipeline(context) {
  const {
    useSqlite,
    sqliteFtsRequested,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    bm25K1,
    bm25B,
    fieldWeights,
    postingsConfig,
    queryTokens,
    queryAst,
    phraseNgramSet,
    phraseRange,
    explain,
    symbolBoost,
    filters,
    filtersActive,
    filterPredicates,
    topN,
    maxCandidates,
    annEnabled,
    annBackend,
    scoreBlend,
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
  const topkSlack = Math.max(8, Math.min(100, Math.ceil(searchTopN * 0.5)));
  const maxCandidateCap = Number.isFinite(Number(maxCandidates)) && Number(maxCandidates) > 0
    ? Math.floor(Number(maxCandidates))
    : null;
  const poolBase = Math.max(searchTopN + topkSlack, expandedTopN * 4, 256);
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
    normalizeScores: sqliteFtsNormalize
  });
  const bm25Provider = createJsBm25Provider({ rankBM25, rankBM25Fields });
  const tantivyProvider = createTantivyProvider();

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
  const markProviderDisabled = (provider, mode, reason) => {
    if (!provider) return;
    if (!provider._disabledModes) provider._disabledModes = new Set();
    if (provider._disabledModes.has(mode)) return;
    provider._disabledModes.add(mode);
    if (reason && !provider._disabledReason) {
      provider._disabledReason = reason;
    }
  };
  const isProviderDisabled = (provider, mode) => (
    Boolean(provider?._disabledModes && provider._disabledModes.has(mode))
  );

  /**
   * Execute the full search pipeline for a mode.
   * @param {object} idx
    * @param {'code'|'prose'|'records'|'extracted-prose'} mode
    * @param {number[]|null} queryEmbedding
    * @returns {Promise<Array<object>>}
    */
  return async function runSearch(idx, mode, queryEmbedding) {
    throwIfAborted();
    const meta = idx.chunkMeta;
    const sqliteEnabledForMode = useSqlite && (mode === 'code' || mode === 'prose');
    const filtersEnabled = typeof filtersActive === 'boolean'
      ? filtersActive
      : hasActiveFilters(filters);
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

      const intersectCandidateSet = (candidateSet, allowedSet) => {
        if (!allowedSet) return { set: candidateSet, owned: false };
        const resolvedAllowed = allowedSet instanceof Set ? allowedSet : bitmapToSet(allowedSet);
        if (!candidateSet) return { set: resolvedAllowed, owned: !(allowedSet instanceof Set) };
        if (candidateSet === resolvedAllowed) return { set: candidateSet, owned: false };
        const filtered = candidatePool.acquire();
        for (const id of candidateSet) {
          if (hasAllowedId(allowedSet, id)) filtered.add(id);
        }
        return { set: filtered, owned: true };
      };

      // Main search: BM25 token match (with optional SQLite FTS first pass)
      const candidateMetrics = {};
      const candidateResult = runStage('candidates', candidateMetrics, () => {
        let candidates = null;
        let bmHits = [];
        let sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
        let sqliteFtsUsed = false;
        const sqliteFtsAllowed = allowedIdx && allowedCount
          ? (allowedCount <= SQLITE_IN_LIMIT ? ensureAllowedSet(allowedIdx) : null)
          : null;
        const sqliteFtsCanPushdown = !!(sqliteFtsAllowed && sqliteFtsAllowed.size <= SQLITE_IN_LIMIT);
        const sqliteFtsEligible = sqliteEnabledForMode
        && sqliteFtsRequested
        && (typeof sqliteHasFts !== 'function' || sqliteHasFts(mode))
        && (!filtersEnabled || sqliteFtsCanPushdown);
        const wantsTantivy = normalizedSparseBackend === 'tantivy';
        const buildCandidatesFromHits = (hits) => {
          if (!hits || !hits.length) return null;
          const set = candidatePool.acquire();
          for (const hit of hits) {
            if (Number.isFinite(hit?.idx)) set.add(hit.idx);
          }
          trackReleaseSet(set);
          return set;
        };
        if (wantsTantivy) {
          const tantivyResult = tantivyProvider.search({
            idx,
            queryTokens,
            mode,
            topN: expandedTopN,
            allowedIds: allowedIdx
          });
          bmHits = tantivyResult.hits;
          sparseType = tantivyResult.type;
          if (bmHits.length) {
            candidates = buildCandidatesFromHits(bmHits);
          }
        } else if (sqliteFtsEligible) {
          const ftsResult = sqliteFtsProvider.search({
            idx,
            queryTokens,
            mode,
            topN: expandedTopN,
            allowedIds: sqliteFtsCanPushdown ? sqliteFtsAllowed : null
          });
          bmHits = ftsResult.hits;
          sqliteFtsUsed = bmHits.length > 0;
          if (sqliteFtsUsed) {
            sparseType = ftsResult.type;
            candidates = buildCandidatesFromHits(bmHits);
          }
        }
        if (!bmHits.length && !wantsTantivy) {
          const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode) : null;
          candidates = buildCandidateSet(idx, queryTokens, mode);
          trackReleaseSet(candidates);
          const bm25Result = bm25Provider.search({
            idx,
            queryTokens,
            mode,
            topN: expandedTopN,
            allowedIds: allowedIdx,
            fieldWeights,
            k1: bm25K1,
            b: bm25B,
            tokenIndexOverride
          });
          bmHits = bm25Result.hits;
          sparseType = bm25Result.type;
          sqliteFtsUsed = false;
        }
        candidateMetrics.counts = {
          allowed: allowedIdx ? allowedCount : null,
          candidates: candidates ? candidates.size : null,
          bmHits: bmHits.length
        };
        candidateMetrics.sqliteFtsUsed = sqliteFtsUsed;
        candidateMetrics.sparseType = sparseType;
        return { candidates, bmHits, sparseType, sqliteFtsUsed };
      });
      let { candidates, bmHits, sparseType, sqliteFtsUsed } = candidateResult;

      // MinHash (embedding) ANN, if requested
      const annMetrics = {};
      const annResult = await runStageAsync('ann', annMetrics, async () => {
        let annHits = [];
        let annSource = null;
        let warned = false;

        if (!annEnabled) {
          annMetrics.vectorActive = false;
          annMetrics.hits = 0;
          annMetrics.source = null;
          annMetrics.warned = false;
          annMetrics.candidates = null;
          annMetrics.providerAvailable = false;
          return { annHits, annSource };
        }

        const ensureCandidateBase = () => {
          if (candidates) return candidates;
          if (!bmHits.length) return null;
          const set = candidatePool.acquire();
          for (const hit of bmHits) {
            if (Number.isFinite(hit?.idx)) set.add(hit.idx);
          }
          trackReleaseSet(set);
          candidates = set;
          return set;
        };

        const annCandidateBase = ensureCandidateBase();
        const { set: annCandidates, owned: annCandidatesOwned } = intersectCandidateSet(annCandidateBase, allowedIdx);
        if (annCandidatesOwned) trackReleaseSet(annCandidates);
        const annFallback = annCandidateBase && allowedIdx ? allowedIdx : null;

        const normalizeAnnHits = (hits) => {
          if (!Array.isArray(hits)) return [];
          return hits
            .filter((hit) => Number.isFinite(hit?.idx) && Number.isFinite(hit?.sim))
            .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx));
        };

        const ensureProviderPreflight = async (provider) => {
          if (!provider || typeof provider.preflight !== 'function') return true;
          if (!provider._preflight) provider._preflight = new Map();
          if (provider._preflight.has(mode)) {
            return provider._preflight.get(mode);
          }
          try {
            const result = await provider.preflight({
              idx,
              mode,
              embedding: queryEmbedding,
              signal
            });
            const ok = result !== false;
            provider._preflight.set(mode, ok);
            if (!ok) markProviderDisabled(provider, mode, 'preflight failed');
            return ok;
          } catch (err) {
            provider._preflight.set(mode, false);
            markProviderDisabled(provider, mode, err?.message || 'preflight failed');
            return false;
          }
        };

        const runAnnQuery = async (provider, candidateSet) => {
          if (!provider || typeof provider.query !== 'function') return [];
          try {
            const hits = await provider.query({
              idx,
              mode,
              embedding: queryEmbedding,
              topN: expandedTopN,
              candidateSet,
              signal
            });
            return normalizeAnnHits(hits);
          } catch (err) {
            markProviderDisabled(provider, mode, err?.message || 'query failed');
            return [];
          }
        };

        const hasVectorArtifacts = Boolean(
          idx?.denseVec?.vectors?.length
        || vectorAnnState?.[mode]?.available
        || hnswAnnState?.[mode]?.available
        || lanceAnnState?.[mode]?.available
        );
        const vectorActive = annEnabled && isEmbeddingReady(queryEmbedding) && hasVectorArtifacts;
        let providerAvailable = false;

        if (annEnabled && vectorActive) {
          const providers = getAnnProviders();
          for (const backend of annOrder) {
            const provider = providers.get(backend);
            if (!provider || typeof provider.query !== 'function') continue;
            if (isProviderDisabled(provider, mode)) continue;
            if (!provider.isAvailable({ idx, mode, embedding: queryEmbedding })) continue;
            const preflightOk = await ensureProviderPreflight(provider);
            if (!preflightOk) continue;
            providerAvailable = true;
            annHits = await runAnnQuery(provider, annCandidates);
            if (!annHits.length && annFallback) {
              annHits = await runAnnQuery(provider, annFallback);
            }
            if (annHits.length) {
              annSource = provider?.id || backend;
              break;
            }
          }
          if (!providerAvailable && annCandidateBase && annCandidateBase.size > 0) {
            warnAnnFallback(`Vector ANN unavailable for ${mode}.`);
            warned = true;
          }
        }

        if (annEnabled && !annHits.length) {
          const minhashBase = annCandidateBase;
          const { set: minhashCandidates, owned: minhashOwned } = intersectCandidateSet(minhashBase, allowedIdx);
          if (minhashOwned) trackReleaseSet(minhashCandidates);
          const minhashFallback = minhashBase && allowedIdx ? allowedIdx : null;
          const minhashCandidatesEmpty = minhashCandidates && minhashCandidates.size === 0;
          const minhashTotal = minhashCandidates
            ? minhashCandidates.size
            : (idx.minhash?.signatures?.length || 0);
          const allowMinhash = minhashTotal > 0 && (!minhashLimit || minhashTotal <= minhashLimit);
          if (allowMinhash && !minhashCandidatesEmpty) {
            annHits = rankMinhash(idx, queryTokens, expandedTopN, minhashCandidates);
            if (annHits.length) annSource = 'minhash';
          }
          if (!annHits.length && allowMinhash && minhashFallback) {
            annHits = rankMinhash(idx, queryTokens, expandedTopN, minhashFallback);
            if (annHits.length) annSource = 'minhash';
          }
        }

        annMetrics.vectorActive = vectorActive;
        annMetrics.hits = annHits.length;
        annMetrics.source = annSource;
        annMetrics.warned = warned;
        annMetrics.candidates = annCandidateBase ? annCandidateBase.size : null;
        annMetrics.providerAvailable = providerAvailable;

        return { annHits, annSource };
      });
      let { annHits, annSource } = annResult;

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
        capacity: Math.max(bmHits.length + annHits.length, searchTopN + topkSlack)
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
        const idsToLoad = new Set();
        bmHits.forEach((h) => idsToLoad.add(h.idx));
        annHits.forEach((h) => idsToLoad.add(h.idx));
        const missing = Array.from(idsToLoad).filter((id) => !meta[id]);
        if (missing.length) idx.loadChunkMetaByIds(mode, missing, meta);
      }
      if (signal?.aborted) {
        const error = createError(ERROR_CODES.CANCELLED, 'Search cancelled.');
        error.cancelled = true;
        throw error;
      }

      const rankMetrics = {};
      const ranked = runStage('rank', rankMetrics, () => {
        const topkStats = {};
        const reducer = createTopKReducer({
          k: searchTopN,
          slack: topkSlack,
          stats: topkStats,
          buildPayload: (entry) => entry?.payload ?? entry?.item ?? entry
        });
        const processEntry = (entry, sourceRank) => {
          if (!entry) return;
          if (allowedIdx && !hasAllowedId(allowedIdx, entry.idx)) return;
          abortIfNeeded();
          const idxVal = entry.idx;
          const sparseScore = entry.sparseScore;
          const annScore = entry.annScore;
          const sparseTypeValue = entry.sparseType;
          const scoreType = entry.scoreType;
          let score = entry.score;
          const blendInfo = entry.blendInfo;
          const chunk = meta[idxVal];
          if (!chunk) return;
          if (!matchesQueryAst(idx, idxVal, chunk)) return;
          const fileRelations = idx.fileRelations
            ? (typeof idx.fileRelations.get === 'function'
              ? idx.fileRelations.get(chunk.file)
              : idx.fileRelations[chunk.file])
            : null;
          const enrichedChunk = fileRelations
            ? {
              ...chunk,
              imports: fileRelations.imports || chunk.imports,
              exports: fileRelations.exports || chunk.exports,
              usages: fileRelations.usages || chunk.usages,
              importLinks: fileRelations.importLinks || chunk.importLinks
            }
            : chunk;
          let phraseMatches = 0;
          let phraseBoost = 0;
          let phraseFactor = 0;
          if (phraseNgramSet && phraseNgramSet.size) {
            const matchInfo = getPhraseMatchInfo(idx, idxVal, phraseNgramSet, chunk?.tokens);
            phraseMatches = matchInfo.matches;
            if (phraseMatches) {
              phraseFactor = Math.min(0.5, phraseMatches * 0.1);
              phraseBoost = score * phraseFactor;
              score += phraseBoost;
            }
          }
          let symbolBoost = 0;
          let symbolFactor = 1;
          let symbolInfo = null;
          if (symbolBoostEnabled) {
            const isDefinition = isDefinitionKind(chunk.kind);
            const isExported = isExportedChunk(enrichedChunk);
            let factor = 1;
            if (isDefinition) factor *= symbolBoostDefinitionWeight;
            if (isExported) factor *= symbolBoostExportWeight;
            symbolFactor = factor;
            if (factor !== 1) {
              symbolBoost = score * (factor - 1);
              score *= factor;
            }
            symbolInfo = {
              definition: isDefinition,
              export: isExported,
              factor: symbolFactor,
              boost: symbolBoost
            };
          }
          const scoreBreakdown = explain ? {
            sparse: sparseScore != null ? {
              type: sparseTypeValue,
              score: sparseScore,
              normalized: sparseTypeValue === 'fts' ? sqliteFtsNormalize : null,
              weights: sparseTypeValue === 'fts' ? sqliteFtsWeights : null,
              profile: sparseTypeValue === 'fts' ? sqliteFtsProfile : null,
              fielded: fieldWeightsEnabled || false,
              k1: sparseTypeValue && sparseTypeValue !== 'fts' ? bm25K1 : null,
              b: sparseTypeValue && sparseTypeValue !== 'fts' ? bm25B : null,
              ftsFallback: sqliteFtsRequested ? !sqliteFtsUsed : false
            } : null,
            ann: annScore != null ? {
              score: annScore,
              source: entry.annSource || null
            } : null,
            rrf: useRrf ? blendInfo : null,
            phrase: phraseNgramSet ? {
              matches: phraseMatches,
              boost: phraseBoost,
              factor: phraseFactor
            } : null,
            symbol: symbolInfo,
            blend: blendEnabled && !useRrf ? blendInfo : null,
            selected: {
              type: scoreType,
              score
            }
          } : null;
          const payload = {
            idx: idxVal,
            score,
            scoreType,
            scoreBreakdown,
            chunk: enrichedChunk,
            sparseScore,
            sparseType: sparseTypeValue,
            annScore,
            annSource: entry.annSource || null
          };
          reducer.pushRaw(score, idxVal, sourceRank, payload);
        };

        let sourceRank = 0;
        if (Array.isArray(fusedScores)) {
          for (const entry of fusedScores) {
            processEntry(entry, sourceRank);
            sourceRank += 1;
          }
        } else if (fusedScores && Array.isArray(fusedScores.entries)) {
          for (let i = 0; i < fusedScores.count; i += 1) {
            processEntry(fusedScores.entries[i], sourceRank);
            sourceRank += 1;
          }
        }

        let scored = reducer.finish({ limit: searchTopN });
        const poolStatsEnd = poolSnapshot();
        rankMetrics.topk = {
          k: searchTopN,
          slack: topkSlack,
          ...topkStats
        };
        rankMetrics.buffers = {
          candidate: {
            allocations: (poolStatsEnd.candidate.allocations || 0) - (poolStatsStart.candidate.allocations || 0),
            reuses: (poolStatsEnd.candidate.reuses || 0) - (poolStatsStart.candidate.reuses || 0),
            drops: (poolStatsEnd.candidate.drops || 0) - (poolStatsStart.candidate.drops || 0)
          },
          score: {
            allocations: (poolStatsEnd.score.allocations || 0) - (poolStatsStart.score.allocations || 0),
            reuses: (poolStatsEnd.score.reuses || 0) - (poolStatsStart.score.reuses || 0),
            drops: (poolStatsEnd.score.drops || 0) - (poolStatsStart.score.drops || 0)
          }
        };

        if (graphRankingConfig?.enabled) {
          const ranked = applyGraphRanking({
            entries: scored,
            graphRelations: idx.graphRelations || null,
            config: graphRankingConfig,
            explain
          });
          scored = ranked.entries;
        }

        return scored
          .map((entry) => ({
            ...entry.chunk,
            score: entry.score,
            scoreType: entry.scoreType,
            sparseScore: entry.sparseScore,
            sparseType: entry.sparseType,
            annScore: entry.annScore,
            annSource: entry.annSource,
            annType: entry.annSource,
            ...(explain ? { scoreBreakdown: entry.scoreBreakdown } : {})
          }))
          .filter(Boolean);
      });

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
