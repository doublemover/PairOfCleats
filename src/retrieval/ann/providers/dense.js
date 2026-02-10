import { rankDenseVectors } from '../../rankers.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

const hasDenseVectors = (idx) => (
  Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0
);

export function createDenseAnnProvider() {
  return {
    id: ANN_PROVIDER_IDS.DENSE,
    isAvailable: ({ idx, embedding }) => (
      isAnnProviderAvailable({
        embedding,
        backendReady: hasDenseVectors(idx) || typeof idx?.loadDenseVectors === 'function'
      })
    ),
    query: async ({ idx, embedding, topN, candidateSet, signal }) => {
      let backendReady = hasDenseVectors(idx);
      if (!backendReady && typeof idx?.loadDenseVectors === 'function') {
        await idx.loadDenseVectors();
        backendReady = hasDenseVectors(idx);
      }
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady })) return [];
      const hits = rankDenseVectors(idx, embedding, topN, candidateSet);
      return hits;
    }
  };
}
