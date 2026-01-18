import { rankDenseVectors } from '../../rankers.js';
import { ANN_PROVIDER_IDS } from '../types.js';

const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

export function createDenseAnnProvider() {
  return {
    id: ANN_PROVIDER_IDS.DENSE,
    isAvailable: ({ idx, embedding }) => (
      isEmbeddingReady(embedding)
      && Array.isArray(idx?.denseVec?.vectors)
      && idx.denseVec.vectors.length > 0
    ),
    query: ({ idx, embedding, topN, candidateSet }) => {
      if (!isEmbeddingReady(embedding)) return [];
      if (candidateSet && candidateSet.size === 0) return [];
      const hits = rankDenseVectors(idx, embedding, topN, candidateSet);
      return hits;
    }
  };
}
