import { rankDenseVectors } from '../../rankers.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';
import { isDenseVectorPayloadAvailable } from '../../../shared/dense-vector-artifacts.js';

const hasDenseVectors = (idx) => isDenseVectorPayloadAvailable(idx?.denseVec);

export function createDenseAnnProvider() {
  return {
    id: ANN_PROVIDER_IDS.DENSE,
    isAvailable: ({ idx, embedding }) => (
      isAnnProviderAvailable({
        embedding,
        backendReady: hasDenseVectors(idx) || typeof idx?.loadDenseVectors === 'function'
      })
    ),
    query: ({ idx, embedding, topN, candidateSet, signal }) => {
      // Fast-gate invalid/aborted queries before any async backend hydration.
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady: true })) return [];
      let backendReady = hasDenseVectors(idx);
      if (!backendReady && typeof idx?.loadDenseVectors === 'function') {
        return Promise.resolve(idx.loadDenseVectors()).then(() => {
          const reloadedReady = hasDenseVectors(idx);
          if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady: reloadedReady })) return [];
          return rankDenseVectors(idx, embedding, topN, candidateSet);
        });
      }
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady })) return [];
      return rankDenseVectors(idx, embedding, topN, candidateSet);
    }
  };
}
