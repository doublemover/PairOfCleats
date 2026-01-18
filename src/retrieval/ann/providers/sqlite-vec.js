import { ANN_PROVIDER_IDS } from '../types.js';

const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

export function createSqliteVectorAnnProvider({
  rankVectorAnnSqlite,
  vectorAnnState,
  vectorAnnUsed
}) {
  return {
    id: ANN_PROVIDER_IDS.SQLITE_VECTOR,
    isAvailable: ({ mode, embedding }) => (
      typeof rankVectorAnnSqlite === 'function'
      && isEmbeddingReady(embedding)
      && vectorAnnState?.[mode]?.available
    ),
    query: ({ mode, embedding, topN, candidateSet }) => {
      if (!isEmbeddingReady(embedding)) return [];
      if (candidateSet && candidateSet.size === 0) return [];
      if (typeof rankVectorAnnSqlite !== 'function') return [];
      if (!vectorAnnState?.[mode]?.available) return [];
      const hits = rankVectorAnnSqlite(mode, embedding, topN, candidateSet);
      if (hits.length && vectorAnnUsed && mode in vectorAnnUsed) {
        vectorAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
