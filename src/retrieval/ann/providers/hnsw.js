import { rankHnswIndex } from '../../../shared/hnsw.js';
import { ANN_PROVIDER_IDS } from '../types.js';

const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

export function createHnswAnnProvider({ hnswAnnState, hnswAnnUsed }) {
  return {
    id: ANN_PROVIDER_IDS.HNSW,
    isAvailable: ({ idx, mode, embedding }) => (
      isEmbeddingReady(embedding)
      && (idx?.hnsw?.available || hnswAnnState?.[mode]?.available)
    ),
    query: ({ idx, mode, embedding, topN, candidateSet, signal }) => {
      if (signal?.aborted) return [];
      if (!isEmbeddingReady(embedding)) return [];
      if (candidateSet && candidateSet.size === 0) return [];
      if (!(idx?.hnsw?.available || hnswAnnState?.[mode]?.available)) return [];
      const hits = rankHnswIndex(idx.hnsw || {}, embedding, topN, candidateSet);
      if (hits.length && hnswAnnUsed && mode in hnswAnnUsed) {
        hnswAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
