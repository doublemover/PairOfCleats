import { filterChunks } from './output.js';
import { hasActiveFilters } from './filters.js';
import { rankBM25, rankBM25Fields, rankDenseVectors, rankMinhash } from './rankers.js';
import { extractNgrams, tri } from '../shared/tokenize.js';

/**
 * Create a search pipeline runner bound to a shared context.
 * @param {object} context
 * @returns {(idx:object, mode:'code'|'prose'|'records'|'extracted-prose', queryEmbedding:number[]|null)=>Array<object>}
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
    scoreBlend,
    minhashMaxDocs,
    vectorAnnState,
    vectorAnnUsed,
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
  const symbolBoostExportWeight = Number.isFinite(Number(symbolBoost?.exportWeight))
    ? Number(symbolBoost.exportWeight)
    : 1.1;
  const rrfEnabled = rrf?.enabled !== false;
  const rrfK = Number.isFinite(Number(rrf?.k))
    ? Math.max(1, Number(rrf.k))
    : 60;
  const minhashLimit = Number.isFinite(Number(minhashMaxDocs)) && Number(minhashMaxDocs) > 0
    ? Number(minhashMaxDocs)
    : null;
    const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
      ? null
      : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
    const fieldWeightsEnabled = fieldWeights
      && Object.values(fieldWeights).some((value) => Number.isFinite(Number(value)) && Number(value) > 0);

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

  function getPhraseMatchInfo(chunk, phraseSet, range) {
    if (!phraseSet || !phraseSet.size || !chunk) return { matches: 0 };
    let ngrams = Array.isArray(chunk.ngrams) && chunk.ngrams.length ? chunk.ngrams : null;
    if (!ngrams && Array.isArray(chunk.tokens) && range?.min && range?.max) {
      ngrams = extractNgrams(chunk.tokens, range.min, range.max);
    }
    if (!ngrams || !ngrams.length) return { matches: 0 };
    let matches = 0;
    for (const ng of ngrams) {
      if (phraseSet.has(ng)) matches += 1;
    }
    return { matches };
  }

  /**
   * Execute the full search pipeline for a mode.
   * @param {object} idx
    * @param {'code'|'prose'|'records'|'extracted-prose'} mode
    * @param {number[]|null} queryEmbedding
    * @returns {Array<object>}
    */
  return function runSearch(idx, mode, queryEmbedding) {
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

    const searchTopN = Math.max(1, Number(topN) || 1);
    const expandedTopN = searchTopN * 3;

    // Main search: BM25 token match (with optional SQLite FTS first pass)
    let candidates = null;
    let bmHits = [];
    let sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
    let sqliteFtsUsed = false;
    if (sqliteEnabledForMode && sqliteFtsRequested) {
      bmHits = rankSqliteFts(idx, queryTokens, mode, expandedTopN, sqliteFtsNormalize);
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
          k1: bm25K1,
          b: bm25B
        })
        : rankBM25({
          idx,
          tokens: queryTokens,
          topN: expandedTopN,
          tokenIndexOverride,
          k1: bm25K1,
          b: bm25B
        });
      sparseType = fieldWeightsEnabled ? 'bm25-fielded' : 'bm25';
      sqliteFtsUsed = false;
    }

    // MinHash (embedding) ANN, if requested
    let annHits = [];
    let annSource = null;
    if (annEnabled) {
      if (queryEmbedding && vectorAnnState?.[mode]?.available) {
        annHits = rankVectorAnnSqlite(mode, queryEmbedding, expandedTopN, candidates);
        if (!annHits.length && candidates && candidates.size) {
          annHits = rankVectorAnnSqlite(mode, queryEmbedding, expandedTopN, null);
        }
        if (annHits.length) {
          vectorAnnUsed[mode] = true;
          annSource = 'sqlite-vector';
        }
      }
      if (!annHits.length && queryEmbedding && idx.denseVec?.vectors?.length) {
        annHits = rankDenseVectors(idx, queryEmbedding, expandedTopN, candidates);
        if (annHits.length) annSource = 'dense';
      }
      if (!annHits.length) {
        const minhashCandidates = candidates || (bmHits.length ? new Set(bmHits.map((h) => h.idx)) : null);
        const minhashTotal = minhashCandidates ? minhashCandidates.size : (idx.minhash?.signatures?.length || 0);
        const allowMinhash = minhashTotal > 0 && (!minhashLimit || minhashTotal <= minhashLimit);
        if (allowMinhash) {
          annHits = rankMinhash(idx, queryTokens, expandedTopN, minhashCandidates);
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
        if (phraseNgramSet && phraseRange?.min && phraseRange?.max) {
          const matchInfo = getPhraseMatchInfo(chunk, phraseNgramSet, phraseRange);
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
