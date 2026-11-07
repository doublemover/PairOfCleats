import { rankDenseVectorsAsync } from '../../rankers.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';
import { isDenseVectorPayloadAvailable } from '../../../shared/dense-vector-artifacts.js';

const hasDenseVectors = (idx) => isDenseVectorPayloadAvailable(idx?.denseVec);

/** @returns {import('../types.js').AnnProvider} */
export function createDenseAnnProvider() {
  return {
    id: ANN_PROVIDER_IDS.DENSE,
    capabilities: Object.freeze({ predicate: 'candidate-ids', exhaustiveStored: true,
      progressiveEffort: false, cancellation: 'cooperative-scalar-blocks', scoreSpace: 'stored-affine-uint8-dot' }),
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
          return rankDenseVectorsAsync(idx, embedding, topN, candidateSet, { signal });
        });
      }
      if (!canRunAnnQuery({ signal, embedding, candidateSet, backendReady })) return [];
      return rankDenseVectorsAsync(idx, embedding, topN, candidateSet, { signal });
    }
  };
}
