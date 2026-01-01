import { filterChunks } from './output.js';
import { rankBM25, rankDenseVectors, rankMinhash } from './rankers.js';
import { extractNgrams, tri } from '../shared/tokenize.js';

/**
 * Create a search pipeline runner bound to a shared context.
 * @param {object} context
 * @returns {(idx:object, mode:'code'|'prose'|'records', queryEmbedding:number[]|null)=>Array<object>}
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
    postingsConfig,
    queryTokens,
    phraseNgramSet,
    phraseRange,
    filters,
    topN,
    annEnabled,
    vectorAnnState,
    vectorAnnUsed,
    buildCandidateSetSqlite,
    getTokenIndexForQuery,
    rankSqliteFts,
    rankVectorAnnSqlite
  } = context;

  /**
   * Build a candidate set from file-backed indexes (or SQLite).
   * @param {object} idx
   * @param {string[]} tokens
   * @param {'code'|'prose'|'records'} mode
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
   * @param {'code'|'prose'|'records'} mode
   * @param {number[]|null} queryEmbedding
   * @returns {Array<object>}
   */
  return function runSearch(idx, mode, queryEmbedding) {
    const meta = idx.chunkMeta;
    const sqliteEnabledForMode = useSqlite && (mode === 'code' || mode === 'prose');

    // Filtering
    const filteredMeta = filterChunks(meta, filters, idx.filterIndex);
    const allowedIdx = new Set(filteredMeta.map((c) => c.id));

    const searchTopN = Math.max(1, Number(topN) || 1);
    const expandedTopN = searchTopN * 3;

    // Main search: BM25 token match
    let candidates = null;
    let bmHits = [];
    if (sqliteEnabledForMode && sqliteFtsRequested) {
      bmHits = rankSqliteFts(idx, queryTokens, mode, expandedTopN, sqliteFtsNormalize);
      candidates = bmHits.length ? new Set(bmHits.map((h) => h.idx)) : null;
    } else {
      const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode) : null;
      candidates = buildCandidateSet(idx, queryTokens, mode);
      bmHits = rankBM25({
        idx,
        tokens: queryTokens,
        topN: expandedTopN,
        tokenIndexOverride,
        k1: bm25K1,
        b: bm25B
      });
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
        annHits = rankMinhash(idx, queryTokens, expandedTopN);
        if (annHits.length) annSource = 'minhash';
      }
    }

    // Combine and dedup
    const allHits = new Map();
    const sparseType = (sqliteEnabledForMode && sqliteFtsRequested) ? 'fts' : 'bm25';
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

    const scored = [...allHits.entries()]
      .filter(([idxVal]) => allowedIdx.has(idxVal))
      .map(([idxVal, scores]) => {
        const sparseScore = scores.fts ?? scores.bm25 ?? null;
        const annScore = scores.ann ?? null;
        const sparseTypeValue = scores.fts != null ? 'fts' : (scores.bm25 != null ? 'bm25' : null);
        let scoreType = null;
        let score = null;
        if (annScore != null && (sparseScore == null || annScore > sparseScore)) {
          scoreType = 'ann';
          score = annScore;
        } else if (sparseScore != null) {
          scoreType = sparseTypeValue;
          score = sparseScore;
        } else {
          scoreType = 'none';
          score = 0;
        }
        const chunk = meta[idxVal];
        if (!chunk) return null;
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
        const scoreBreakdown = {
          sparse: sparseScore != null ? {
            type: sparseTypeValue,
            score: sparseScore,
            normalized: scores.fts != null ? sqliteFtsNormalize : null,
            weights: scores.fts != null ? sqliteFtsWeights : null,
            profile: scores.fts != null ? sqliteFtsProfile : null,
            k1: scores.bm25 != null ? bm25K1 : null,
            b: scores.bm25 != null ? bm25B : null
          } : null,
          ann: annScore != null ? {
            score: annScore,
            source: scores.annSource || null
          } : null,
          phrase: phraseNgramSet ? {
            matches: phraseMatches,
            boost: phraseBoost,
            factor: phraseFactor
          } : null,
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
          chunk,
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
