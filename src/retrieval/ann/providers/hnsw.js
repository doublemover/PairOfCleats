import { rankHnswIndex } from '../../../shared/hnsw.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

export function createHnswAnnProvider({ hnswAnnState, hnswAnnUsed }) {
  return {
    id: ANN_PROVIDER_IDS.HNSW,
    isAvailable: ({ idx, mode, embedding }) => {
      const backendReady = Boolean(idx?.hnsw?.available || hnswAnnState?.[mode]?.available);
      return isAnnProviderAvailable({ embedding, backendReady });
    },
    query: ({ idx, mode, embedding, topN, candidateSet, signal }) => {
      const backendReady = Boolean(idx?.hnsw?.available || hnswAnnState?.[mode]?.available);
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady })) return [];
      const hits = rankHnswIndex(idx.hnsw || {}, embedding, topN, candidateSet);
      if (hits.length && hnswAnnUsed && mode in hnswAnnUsed) {
        hnswAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
