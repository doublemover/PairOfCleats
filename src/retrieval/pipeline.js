import { filterChunks } from './output.js';
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

const SQLITE_IN_LIMIT = 900;

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
    stageTracker
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
  const buildCandidateSet = createCandidateSetBuilder({
    useSqlite,
    postingsConfig,
    buildCandidateSetSqlite,
    chargramMaxTokenLength,
    maxCandidates
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

  const annProviders = new Map([
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

  const annOrder = resolveAnnOrder(annBackend);

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
    const runStage = (stage, fn) => (
      stageTracker?.spanSync ? stageTracker.spanSync(stage, stageMeta, fn) : fn()
    );
    const runStageAsync = (stage, fn) => (
      stageTracker?.span ? stageTracker.span(stage, stageMeta, fn) : fn()
    );

    // Filtering
    const filterResult = runStage('filter', () => {
      const filtered = filtersEnabled
        ? filterChunks(meta, filters, idx.filterIndex, idx.fileRelations)
        : meta;
      const allowed = filtersEnabled ? new Set(filtered.map((c) => c.id)) : null;
      return { filtered, allowed };
    });
    const filteredMeta = filterResult.filtered;
    throwIfAborted();
    const allowedIdx = filterResult.allowed;
    if (filtersEnabled && (!allowedIdx || allowedIdx.size === 0)) {
      return [];
    }
    throwIfAborted();

    const intersectCandidateSet = (candidateSet, allowedSet) => {
      if (!allowedSet) return candidateSet;
      if (!candidateSet) return allowedSet;
      const filtered = new Set();
      for (const id of candidateSet) {
        if (allowedSet.has(id)) filtered.add(id);
      }
      return filtered;
    };

    const searchTopN = Math.max(1, Number(topN) || 1);
    const expandedTopN = searchTopN * 3;

    // Main search: BM25 token match (with optional SQLite FTS first pass)
    const candidateResult = runStage('candidates', () => {
      let candidates = null;
      let bmHits = [];
      let sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
      let sqliteFtsUsed = false;
      const sqliteFtsAllowed = allowedIdx && allowedIdx.size ? allowedIdx : null;
      const sqliteFtsCanPushdown = !!(sqliteFtsAllowed && sqliteFtsAllowed.size <= SQLITE_IN_LIMIT);
      const sqliteFtsEligible = sqliteEnabledForMode
        && sqliteFtsRequested
        && (typeof sqliteHasFts !== 'function' || sqliteHasFts(mode))
        && (!filtersEnabled || sqliteFtsCanPushdown);
      const wantsTantivy = normalizedSparseBackend === 'tantivy';
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
          candidates = new Set(bmHits.map((h) => h.idx));
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
          candidates = new Set(bmHits.map((h) => h.idx));
        }
      }
      if (!bmHits.length && !wantsTantivy) {
        const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode) : null;
        candidates = buildCandidateSet(idx, queryTokens, mode);
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
      return { candidates, bmHits, sparseType, sqliteFtsUsed };
    });
    let { candidates, bmHits, sparseType, sqliteFtsUsed } = candidateResult;

    // MinHash (embedding) ANN, if requested
    const annResult = await runStageAsync('ann', async () => {
      let annHits = [];
      let annSource = null;
      const annCandidateBase = candidates
        || (bmHits.length ? new Set(bmHits.map((h) => h.idx)) : null);
      const annCandidates = intersectCandidateSet(annCandidateBase, allowedIdx);
      const annFallback = annCandidateBase && allowedIdx ? allowedIdx : null;
      const normalizeAnnHits = (hits) => {
        if (!Array.isArray(hits)) return [];
        return hits
          .filter((hit) => Number.isFinite(hit?.idx) && Number.isFinite(hit?.sim))
          .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx));
      };

      const runAnnQuery = async (provider, candidateSet) => {
        if (!provider || typeof provider.query !== 'function') return [];
        if (!provider.isAvailable({ idx, mode, embedding: queryEmbedding })) return [];
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
        } catch {
          return [];
        }
      };
      if (annEnabled) {
        for (const backend of annOrder) {
          const provider = annProviders.get(backend);
          annHits = await runAnnQuery(provider, annCandidates);
          if (!annHits.length && annFallback) {
            annHits = await runAnnQuery(provider, annFallback);
          }
          if (annHits.length) {
            annSource = provider?.id || backend;
            break;
          }
        }
        if (!annHits.length) {
          const minhashBase = annCandidateBase;
          const minhashCandidates = intersectCandidateSet(minhashBase, allowedIdx);
          const minhashFallback = minhashBase && allowedIdx ? allowedIdx : null;
          const minhashCandidatesEmpty = minhashCandidates && minhashCandidates.size === 0;
          const minhashTotal = minhashCandidates ? minhashCandidates.size : (idx.minhash?.signatures?.length || 0);
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
      }
      return { annHits, annSource };
    });
    let { annHits, annSource } = annResult;

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
        fieldWeightsEnabled
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

    const ranked = runStage('rank', () => {
      let scored = fusedScores
        .filter((entry) => !allowedIdx || allowedIdx.has(entry.idx))
        .map((entry) => {
          abortIfNeeded();
          const idxVal = entry.idx;
          const sparseScore = entry.sparseScore;
          const annScore = entry.annScore;
          const sparseTypeValue = entry.sparseType;
          let scoreType = entry.scoreType;
          let score = entry.score;
          const blendInfo = entry.blendInfo;
          const chunk = meta[idxVal];
          if (!chunk) return null;
          if (!matchesQueryAst(idx, idxVal, chunk)) return null;
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
          return {
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
        })
        .filter(Boolean)
        .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
        .slice(0, searchTopN);

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
  };
}
