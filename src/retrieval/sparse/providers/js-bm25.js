import { SPARSE_PROVIDER_IDS } from '../types.js';

/** @returns {import('../types.js').SparseProvider<import('../types.js').SparseSearchParams,import('../types.js').SparseRankedResult>} */
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
      includeZeroScores = false,
      work = null
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
          work,
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
          work,
          allowedIdx: allowedIds,
          k1,
          b
        });
      const hasFieldPostings = idx?.fieldPostings?.fields
        && Object.keys(idx.fieldPostings.fields).length > 0;
      return { hits, type: fieldPolicyConfigured && hasFieldPostings ? 'bm25-fielded' : 'bm25' };
    }
  };
}
