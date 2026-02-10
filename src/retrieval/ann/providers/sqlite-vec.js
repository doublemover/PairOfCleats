import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

export function createSqliteVectorAnnProvider({
  rankVectorAnnSqlite,
  vectorAnnState,
  vectorAnnUsed
}) {
  const hasRanker = typeof rankVectorAnnSqlite === 'function';
  const isBackendReady = (mode) => Boolean(vectorAnnState?.[mode]?.available);

  return {
    id: ANN_PROVIDER_IDS.SQLITE_VECTOR,
    isAvailable: ({ mode, embedding }) => isAnnProviderAvailable({
      embedding,
      backendReady: hasRanker && isBackendReady(mode)
    }),
    query: ({ mode, embedding, topN, candidateSet, signal }) => {
      if (!canRunAnnQuery({
        signal,
        embedding,
        candidateSet,
        backendReady: hasRanker && isBackendReady(mode)
      })) {
        return [];
      }
      const hits = rankVectorAnnSqlite(mode, embedding, topN, candidateSet);
      if (hits.length && vectorAnnUsed && mode in vectorAnnUsed) {
        vectorAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
