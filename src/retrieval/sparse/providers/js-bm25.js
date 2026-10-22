import { SPARSE_PROVIDER_IDS } from '../types.js';

export function createJsBm25Provider({ rankBM25, rankBM25Fields }) {
  return {
    id: SPARSE_PROVIDER_IDS.JS_BM25,
    search: ({
      idx,
      queryTokens,
      mode,
      topN,
      allowedIds,
      fieldWeights,
      k1,
      b,
      tokenIndexOverride,
      includeZeroScores = false
    }) => {
      const fieldPolicyConfigured = fieldWeights && typeof fieldWeights === 'object';
      const hits = fieldPolicyConfigured
        ? rankBM25Fields({
          idx,
          tokens: queryTokens,
          topN,
          fieldWeights,
          tokenIndexOverride,
          includeZeroScores,
          allowedIdx: allowedIds,
          k1,
          b
        })
        : rankBM25({
          idx,
          tokens: queryTokens,
          topN,
          tokenIndexOverride,
          includeZeroScores,
          allowedIdx: allowedIds,
          k1,
          b
        });
      return { hits, type: fieldPolicyConfigured ? 'bm25-fielded' : 'bm25' };
    }
  };
}
