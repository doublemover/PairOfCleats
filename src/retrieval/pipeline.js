import { filterChunks } from './output.js';
import { hasActiveFilters } from './filters.js';
import { rankBM25, rankBM25Fields, rankDenseVectors, rankMinhash } from './rankers.js';
import { extractNgrams, tri } from '../shared/tokenize.js';
import { rankHnswIndex } from '../shared/hnsw.js';
import { rankLanceDb } from './lancedb.js';

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
    phraseNgramSet,
    phraseRange,
    symbolBoost,
    filters,
    filtersActive,
    topN,
    annEnabled,
    annBackend,
    scoreBlend,
    minhashMaxDocs,
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
    rrf
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
  const minhashLimit = Number.isFinite(Number(minhashMaxDocs))
    && Number(minhashMaxDocs) > 0
    ? Number(minhashMaxDocs)
    : null;
  const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
  const fieldWeightsEnabled = fieldWeights
    && Object.values(fieldWeights).some((value) => (
      Number.isFinite(Number(value)) && Number(value) > 0
    ));

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

  /**
   * Build a candidate set from file-backed indexes (or SQLite).
   * @param {object} idx
   * @param {string[]} tokens
   * @param {'code'|'prose'|'records'|'extracted-prose'} mode
   * @returns {Set<number>|null}
   */
  function buildCandidateSet(idx, tokens, mode) {
    if (useSqlite && (mode === 'code' || mode === 'prose')) {
      return buildCandidateSetSqlite(mode, tokens);
    }

    const candidates = new Set();
    let matched = false;

    if (postingsConfig.enablePhraseNgrams !== false && idx.phraseNgrams?.vocab && idx.phraseNgrams?.postings) {
      const vocabIndex = idx.phraseNgrams.vocabIndex
        || (idx.phraseNgrams.vocabIndex = new Map(idx.phraseNgrams.vocab.map((t, i) => [t, i])));
      const ngrams = extractNgrams(tokens, postingsConfig.phraseMinN, postingsConfig.phraseMaxN);
      for (const ng of ngrams) {
        const hit = vocabIndex.get(ng);
        if (hit === undefined) continue;
        const posting = idx.phraseNgrams.postings[hit] || [];
        posting.forEach((id) => candidates.add(id));
        matched = matched || posting.length > 0;
      }
    }

    if (postingsConfig.enableChargrams !== false && idx.chargrams?.vocab && idx.chargrams?.postings) {
      const vocabIndex = idx.chargrams.vocabIndex
        || (idx.chargrams.vocabIndex = new Map(idx.chargrams.vocab.map((t, i) => [t, i])));
      for (const token of tokens) {
        if (chargramMaxTokenLength && token.length > chargramMaxTokenLength) continue;
        for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; n++) {
          for (const gram of tri(token, n)) {
            const hit = vocabIndex.get(gram);
            if (hit === undefined) continue;
            const posting = idx.chargrams.postings[hit] || [];
            posting.forEach((id) => candidates.add(id));
            matched = matched || posting.length > 0;
          }
        }
      }
    }

    return matched ? candidates : null;
  }

  function postingIncludesDocId(posting, docId) {
    if (!Array.isArray(posting) || !posting.length) return false;
    // Posting lists are built in chunk-id order; use binary search.
    let lo = 0;
    let hi = posting.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = posting[mid];
      if (v === docId) return true;
      if (v < docId) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }

  // Phrase postings are the authoritative source of phrase membership.
  // Do NOT rely on per-chunk ngram arrays: they are optional, often sampled,
  // and (in memory-constrained builds) may not be present at all.
  function getPhraseMatchInfo(idx, chunkId, phraseSet) {
    if (!phraseSet || !phraseSet.size || !idx) return { matches: 0 };
    const phraseIndex = idx.phraseNgrams;
    if (!phraseIndex || !phraseIndex.vocab || !phraseIndex.postings) return { matches: 0 };
    const vocabIndex = phraseIndex.vocabIndex
      || (phraseIndex.vocabIndex = new Map(phraseIndex.vocab.map((t, i) => [t, i])));
    let matches = 0;
    for (const ng of phraseSet) {
      const hit = vocabIndex.get(ng);
      if (hit === undefined) continue;
      const posting = phraseIndex.postings[hit] || [];
      if (postingIncludesDocId(posting, chunkId)) matches += 1;
    }
    return { matches };
  }

  const normalizeAnnBackend = (value) => {
    if (typeof value !== 'string') return 'lancedb';
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return 'lancedb';
    if (trimmed === 'sqlite' || trimmed === 'sqlite-extension') return 'sqlite-vector';
    if (trimmed === 'dense') return 'js';
    return trimmed;
  };

  const resolveAnnOrder = (value) => {
    switch (normalizeAnnBackend(value)) {
      case 'lancedb':
        return ['lancedb', 'sqlite-vector', 'hnsw', 'js'];
      case 'sqlite-vector':
        return ['sqlite-vector', 'lancedb', 'hnsw', 'js'];
      case 'hnsw':
        return ['hnsw', 'lancedb', 'sqlite-vector', 'js'];
      case 'js':
        return ['js'];
      case 'auto':
      default:
        return ['lancedb', 'sqlite-vector', 'hnsw', 'js'];
    }
  };

  const annOrder = resolveAnnOrder(annBackend);

  /**
   * Execute the full search pipeline for a mode.
   * @param {object} idx
    * @param {'code'|'prose'|'records'|'extracted-prose'} mode
    * @param {number[]|null} queryEmbedding
    * @returns {Promise<Array<object>>}
    */
  return async function runSearch(idx, mode, queryEmbedding) {
    const meta = idx.chunkMeta;
    const sqliteEnabledForMode = useSqlite && (mode === 'code' || mode === 'prose');
    const filtersEnabled = typeof filtersActive === 'boolean'
      ? filtersActive
      : hasActiveFilters(filters);

    // Filtering
    const filteredMeta = filtersEnabled
      ? filterChunks(meta, filters, idx.filterIndex, idx.fileRelations)
      : meta;
    const allowedIdx = filtersEnabled ? new Set(filteredMeta.map((c) => c.id)) : null;
    if (filtersEnabled && (!allowedIdx || allowedIdx.size === 0)) {
      return [];
    }

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
    let candidates = null;
    let bmHits = [];
    let sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
    let sqliteFtsUsed = false;
    const sqliteFtsAllowed = allowedIdx && allowedIdx.size ? allowedIdx : null;
    const sqliteFtsCanPushdown = !!(sqliteFtsAllowed && sqliteFtsAllowed.size <= SQLITE_IN_LIMIT);
    const sqliteFtsEligible = sqliteEnabledForMode
      && sqliteFtsRequested
      && (!filtersEnabled || sqliteFtsCanPushdown);
    if (sqliteFtsEligible) {
      bmHits = rankSqliteFts(
        idx,
        queryTokens,
        mode,
        expandedTopN,
        sqliteFtsNormalize,
        sqliteFtsCanPushdown ? sqliteFtsAllowed : null
      );
      sqliteFtsUsed = bmHits.length > 0;
      if (sqliteFtsUsed) {
        sparseType = 'fts';
        candidates = new Set(bmHits.map((h) => h.idx));
      }
    }
    if (!bmHits.length) {
      const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode) : null;
      candidates = buildCandidateSet(idx, queryTokens, mode);
      bmHits = fieldWeightsEnabled
        ? rankBM25Fields({
          idx,
          tokens: queryTokens,
          topN: expandedTopN,
          fieldWeights,
          allowedIdx,
          k1: bm25K1,
          b: bm25B
        })
        : rankBM25({
          idx,
          tokens: queryTokens,
          topN: expandedTopN,
          tokenIndexOverride,
          allowedIdx,
          k1: bm25K1,
          b: bm25B
        });
      sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
      sqliteFtsUsed = false;
    }

    // MinHash (embedding) ANN, if requested
    let annHits = [];
    let annSource = null;
    const annCandidates = intersectCandidateSet(candidates, allowedIdx);
    const annFallback = candidates && allowedIdx ? allowedIdx : null;
    const annCandidatesEmpty = annCandidates && annCandidates.size === 0;
    if (annEnabled) {
      for (const backend of annOrder) {
        if (!queryEmbedding && backend !== 'js') continue;
        if (backend === 'lancedb') {
          if (lancedbConfig?.enabled !== false
            && (idx.lancedb?.available || lanceAnnState?.[mode]?.available)) {
            if (!annCandidatesEmpty) {
              annHits = await rankLanceDb({
                lancedbInfo: idx.lancedb,
                queryEmbedding,
                topN: expandedTopN,
                candidateSet: annCandidates,
                config: lancedbConfig
              });
            }
            if (!annHits.length && annFallback) {
              annHits = await rankLanceDb({
                lancedbInfo: idx.lancedb,
                queryEmbedding,
                topN: expandedTopN,
                candidateSet: annFallback,
                config: lancedbConfig
              });
            }
            if (annHits.length) {
              if (lanceAnnUsed && mode in lanceAnnUsed) lanceAnnUsed[mode] = true;
              annSource = 'lancedb';
              break;
            }
          }
        } else if (backend === 'sqlite-vector') {
          if (queryEmbedding && vectorAnnState?.[mode]?.available) {
            if (!annCandidatesEmpty) {
              annHits = rankVectorAnnSqlite(mode, queryEmbedding, expandedTopN, annCandidates);
            }
            if (!annHits.length && annFallback) {
              annHits = rankVectorAnnSqlite(mode, queryEmbedding, expandedTopN, annFallback);
            }
            if (annHits.length) {
              if (vectorAnnUsed && mode in vectorAnnUsed) vectorAnnUsed[mode] = true;
              annSource = 'sqlite-vector';
              break;
            }
          }
        } else if (backend === 'hnsw') {
          if (queryEmbedding && (idx.hnsw?.available || hnswAnnState?.[mode]?.available)) {
            if (!annCandidatesEmpty) {
              annHits = rankHnswIndex(idx.hnsw || {}, queryEmbedding, expandedTopN, annCandidates);
            }
            if (!annHits.length && annFallback) {
              annHits = rankHnswIndex(idx.hnsw || {}, queryEmbedding, expandedTopN, annFallback);
            }
            if (annHits.length) {
              if (hnswAnnUsed && mode in hnswAnnUsed) hnswAnnUsed[mode] = true;
              annSource = 'hnsw';
              break;
            }
          }
        } else if (backend === 'js') {
          if (queryEmbedding && idx.denseVec?.vectors?.length) {
            if (!annCandidatesEmpty) {
              annHits = rankDenseVectors(idx, queryEmbedding, expandedTopN, annCandidates);
            }
            if (!annHits.length && annFallback) {
              annHits = rankDenseVectors(idx, queryEmbedding, expandedTopN, annFallback);
            }
            if (annHits.length) {
              annSource = 'js';
              break;
            }
          }
        }
      }
      if (!annHits.length) {
        const minhashBase = candidates || (bmHits.length ? new Set(bmHits.map((h) => h.idx)) : null);
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

    const useRrf = rrfEnabled && !blendEnabled && bmHits.length && annHits.length;
    const sparseRanks = new Map();
    const annRanks = new Map();
    if (useRrf) {
      bmHits.forEach((hit, index) => sparseRanks.set(hit.idx, index + 1));
      annHits.forEach((hit, index) => annRanks.set(hit.idx, index + 1));
    }

    if (idx.loadChunkMetaByIds) {
      const idsToLoad = new Set();
      bmHits.forEach((h) => idsToLoad.add(h.idx));
      annHits.forEach((h) => idsToLoad.add(h.idx));
      const missing = Array.from(idsToLoad).filter((id) => !meta[id]);
      if (missing.length) idx.loadChunkMetaByIds(mode, missing, meta);
    }

    // Combine and dedup
    const allHits = new Map();
    const recordHit = (idxVal, update) => {
      const current = allHits.get(idxVal) || { bm25: null, fts: null, ann: null, annSource: null };
      allHits.set(idxVal, { ...current, ...update });
    };
    bmHits.forEach((h) => {
      recordHit(h.idx, sparseType === 'fts' ? { fts: h.score } : { bm25: h.score });
    });
    annHits.forEach((h) => {
      recordHit(h.idx, { ann: h.sim, annSource });
    });

    const sparseMaxScore = bmHits.length
      ? Math.max(...bmHits.map((hit) => (hit.score ?? hit.sim ?? 0)))
      : null;
    const scored = [...allHits.entries()]
      .filter(([idxVal]) => !allowedIdx || allowedIdx.has(idxVal))
      .map(([idxVal, scores]) => {
          const sparseScore = scores.fts ?? scores.bm25 ?? null;
          const annScore = scores.ann ?? null;
          const sparseTypeValue = scores.fts != null
            ? 'fts'
            : (scores.bm25 != null ? (fieldWeightsEnabled ? 'bm25-fielded' : 'bm25') : null);
        let scoreType = null;
        let score = null;
        let blendInfo = null;
        if (useRrf) {
          const sparseRank = sparseRanks.get(idxVal) ?? null;
          const annRank = annRanks.get(idxVal) ?? null;
          const sparseRrf = sparseRank ? 1 / (rrfK + sparseRank) : 0;
          const annRrf = annRank ? 1 / (rrfK + annRank) : 0;
          scoreType = 'rrf';
          score = sparseRrf + annRrf;
          blendInfo = {
            k: rrfK,
            sparseRank,
            annRank,
            sparseRrf,
            annRrf,
            score
          };
        } else if (blendEnabled && (sparseScore != null || annScore != null)) {
          const sparseMax = sparseScore != null
            ? Math.max(sparseScore, sparseMaxScore || 0)
            : 0;
          const normalizedSparse = sparseScore != null && sparseMax > 0
            ? sparseScore / sparseMax
            : null;
          const clippedAnn = annScore != null
            ? Math.max(-1, Math.min(1, annScore))
            : null;
          const normalizedAnn = clippedAnn != null ? (clippedAnn + 1) / 2 : null;
          const activeSparseWeight = normalizedSparse != null ? blendSparseWeight : 0;
          const activeAnnWeight = normalizedAnn != null ? blendAnnWeight : 0;
          const weightSum = activeSparseWeight + activeAnnWeight;
          const blended = weightSum > 0
            ? ((normalizedSparse ?? 0) * activeSparseWeight + (normalizedAnn ?? 0) * activeAnnWeight) / weightSum
            : 0;
          scoreType = 'blend';
          score = blended;
          blendInfo = {
            score: blended,
            sparseNormalized: normalizedSparse,
            annNormalized: normalizedAnn,
            sparseWeight: activeSparseWeight,
            annWeight: activeAnnWeight
          };
        } else if (sparseScore != null) {
          scoreType = sparseTypeValue;
          score = sparseScore;
        } else if (annScore != null) {
          scoreType = 'ann';
          score = annScore;
        } else {
          scoreType = 'none';
          score = 0;
        }
        const chunk = meta[idxVal];
        if (!chunk) return null;
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
          const matchInfo = getPhraseMatchInfo(idx, idxVal, phraseNgramSet);
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
        const scoreBreakdown = {
          sparse: sparseScore != null ? {
            type: sparseTypeValue,
            score: sparseScore,
            normalized: scores.fts != null ? sqliteFtsNormalize : null,
            weights: scores.fts != null ? sqliteFtsWeights : null,
            profile: scores.fts != null ? sqliteFtsProfile : null,
            fielded: fieldWeightsEnabled || false,
            k1: scores.bm25 != null ? bm25K1 : null,
            b: scores.bm25 != null ? bm25B : null,
            ftsFallback: sqliteFtsRequested ? !sqliteFtsUsed : false
          } : null,
          ann: annScore != null ? {
            score: annScore,
            source: scores.annSource || null
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
        };
        return {
          idx: idxVal,
          score,
          scoreType,
          scoreBreakdown,
          chunk: enrichedChunk,
          sparseScore,
          sparseType: sparseTypeValue,
          annScore,
          annSource: scores.annSource || null
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .slice(0, searchTopN);

    const ranked = scored
      .map((entry) => ({
        ...entry.chunk,
        score: entry.score,
        scoreType: entry.scoreType,
        sparseScore: entry.sparseScore,
        sparseType: entry.sparseType,
        annScore: entry.annScore,
        annSource: entry.annSource,
        annType: entry.annSource,
        scoreBreakdown: entry.scoreBreakdown
      }))
      .filter(Boolean);

    return ranked;
  };
}
