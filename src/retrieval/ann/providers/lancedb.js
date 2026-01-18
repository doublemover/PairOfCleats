import { rankLanceDb } from '../../lancedb.js';
import { ANN_PROVIDER_IDS } from '../types.js';

const isEmbeddingReady = (embedding) => (
  (Array.isArray(embedding) || (ArrayBuffer.isView(embedding) && !(embedding instanceof DataView)))
  && embedding.length > 0
);

export function createLanceDbAnnProvider({
  lancedbConfig,
  lanceAnnState,
  lanceAnnUsed
}) {
  return {
    id: ANN_PROVIDER_IDS.LANCEDB,
    isAvailable: ({ idx, mode, embedding }) => (
      isEmbeddingReady(embedding)
      && lancedbConfig?.enabled !== false
      && (idx?.lancedb?.available || lanceAnnState?.[mode]?.available)
    ),
    query: async ({ idx, mode, embedding, topN, candidateSet }) => {
      if (!isEmbeddingReady(embedding)) return [];
      if (candidateSet && candidateSet.size === 0) return [];
      if (lancedbConfig?.enabled === false) return [];
      if (!(idx?.lancedb?.available || lanceAnnState?.[mode]?.available)) return [];
      const hits = await rankLanceDb({
        lancedbInfo: idx.lancedb,
        queryEmbedding: embedding,
        topN,
        candidateSet,
        config: lancedbConfig
      });
      if (hits.length && lanceAnnUsed && mode in lanceAnnUsed) {
        lanceAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
