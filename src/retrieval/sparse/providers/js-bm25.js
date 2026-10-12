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
      const hasWeightedFields = fieldWeightsEnabled && Object.entries(fieldWeights).some(([field, weight]) => (
        Number(weight) > 0 && Array.isArray(idx.fieldPostings?.fields?.[field]?.vocab)
        && idx.fieldPostings.fields[field].vocab.length > 0
      ));
      const hits = hasWeightedFields
        ? rankBM25Fields({
          idx,
          tokens: queryTokens,
          topN,
          fieldWeights,
          tokenIndexOverride,
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
      return { hits, type: hasWeightedFields ? 'bm25-fielded' : 'bm25' };
    }
  };
}
