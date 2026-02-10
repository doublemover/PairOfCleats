import { rankDenseVectors } from '../../rankers.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

export function createDenseAnnProvider() {
  return {
    id: ANN_PROVIDER_IDS.DENSE,
    isAvailable: ({ idx, embedding }) => (
      isAnnProviderAvailable({
        embedding,
        backendReady: Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0
      })
    ),
    query: ({ idx, embedding, topN, candidateSet, signal }) => {
      const backendReady = Array.isArray(idx?.denseVec?.vectors) && idx.denseVec.vectors.length > 0;
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady })) return [];
      const hits = rankDenseVectors(idx, embedding, topN, candidateSet);
      return hits;
    }
  };
}
