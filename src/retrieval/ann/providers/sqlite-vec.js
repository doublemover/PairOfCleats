import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

export function createSqliteVectorAnnProvider({
  rankVectorAnnSqlite,
  vectorAnnState,
  vectorAnnUsed
}) {
  const hasRanker = typeof rankVectorAnnSqlite === 'function';
  const isBackendReady = (mode) => Boolean(vectorAnnState?.[mode]?.available);
  const resolveTopN = (topN, budget) => {
    const budgetTopN = Number(budget?.providerTopN?.[ANN_PROVIDER_IDS.SQLITE_VECTOR]);
    if (Number.isFinite(budgetTopN) && budgetTopN > 0) {
      return Math.max(1, Math.floor(budgetTopN));
    }
    return Math.max(1, Number(topN) || 1);
  };

  return {
    id: ANN_PROVIDER_IDS.SQLITE_VECTOR,
    isAvailable: ({ mode, embedding }) => isAnnProviderAvailable({
      embedding,
      backendReady: hasRanker && isBackendReady(mode)
    }),
    query: ({ mode, embedding, topN, candidateSet, signal, budget }) => {
      const resolvedTopN = resolveTopN(topN, budget);
      if (!canRunAnnQuery({
        signal,
        embedding,
        candidateSet,
        backendReady: hasRanker && isBackendReady(mode)
      })) {
        return [];
      }
      const hits = rankVectorAnnSqlite(mode, embedding, resolvedTopN, candidateSet);
      if (hits.length && vectorAnnUsed && mode in vectorAnnUsed) {
        vectorAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
