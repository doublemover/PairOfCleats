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
      tokenIndexOverride
    }) => {
      const fieldWeightsEnabled = fieldWeights
        && Object.values(fieldWeights).some((value) => (
          Number.isFinite(Number(value)) && Number(value) > 0
        ));
      const hits = fieldWeightsEnabled
        ? rankBM25Fields({
          idx,
          tokens: queryTokens,
          topN,
          fieldWeights,
          allowedIdx: allowedIds,
          k1,
          b
        })
        : rankBM25({
          idx,
          tokens: queryTokens,
          topN,
          tokenIndexOverride,
          allowedIdx: allowedIds,
          k1,
          b
        });
      return { hits, type: fieldWeightsEnabled ? 'bm25-fielded' : 'bm25' };
    }
  };
}
