import { rankHnswIndex } from '../../../shared/hnsw.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

export function createHnswAnnProvider({ hnswAnnState, hnswAnnUsed }) {
  const resolveTopN = (topN, budget) => {
    const budgetTopN = Number(budget?.providerTopN?.[ANN_PROVIDER_IDS.HNSW]);
    if (Number.isFinite(budgetTopN) && budgetTopN > 0) {
      return Math.max(1, Math.floor(budgetTopN));
    }
    return Math.max(1, Number(topN) || 1);
  };

  const resolveEfSearch = (budget) => {
    const budgetEf = Number(budget?.hnswEfSearch);
    if (!Number.isFinite(budgetEf) || budgetEf <= 0) return null;
    return Math.max(1, Math.floor(budgetEf));
  };

  return {
    id: ANN_PROVIDER_IDS.HNSW,
    isAvailable: ({ idx, mode, embedding }) => {
      const backendReady = Boolean(idx?.hnsw?.available || hnswAnnState?.[mode]?.available);
      return isAnnProviderAvailable({ embedding, backendReady });
    },
    query: ({ idx, mode, embedding, topN, candidateSet, signal, budget }) => {
      const backendReady = Boolean(idx?.hnsw?.available || hnswAnnState?.[mode]?.available);
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady })) return [];
      const resolvedTopN = resolveTopN(topN, budget);
      const targetEfSearch = resolveEfSearch(budget);
      const hnswIndex = idx?.hnsw?.index;
      if (targetEfSearch && hnswIndex && typeof hnswIndex.setEf === 'function') {
        try {
          hnswIndex.setEf(targetEfSearch);
        } catch {}
      }
      const hits = rankHnswIndex(idx.hnsw || {}, embedding, resolvedTopN, candidateSet);
      if (hits.length && hnswAnnUsed && mode in hnswAnnUsed) {
        hnswAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
