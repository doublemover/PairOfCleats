import { rankLanceDb } from '../../lancedb.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';

export function createLanceDbAnnProvider({
  lancedbConfig,
  lanceAnnState,
  lanceAnnUsed
}) {
  const isEnabled = lancedbConfig?.enabled !== false;
  const isBackendReady = (idx, mode) => Boolean(idx?.lancedb?.available || lanceAnnState?.[mode]?.available);
  const resolveTopN = (topN, budget) => {
    const budgetTopN = Number(budget?.providerTopN?.[ANN_PROVIDER_IDS.LANCEDB]);
    if (Number.isFinite(budgetTopN) && budgetTopN > 0) {
      return Math.max(1, Math.floor(budgetTopN));
    }
    return Math.max(1, Number(topN) || 1);
  };

  return {
    id: ANN_PROVIDER_IDS.LANCEDB,
    isAvailable: ({ idx, mode, embedding }) => isAnnProviderAvailable({
      embedding,
      enabled: isEnabled,
      backendReady: isBackendReady(idx, mode)
    }),
    query: async ({ idx, mode, embedding, topN, candidateSet, signal, budget }) => {
      const resolvedTopN = resolveTopN(topN, budget);
      if (!canRunAnnQuery({
        signal,
        embedding,
        candidateSet,
        enabled: isEnabled,
        backendReady: isBackendReady(idx, mode)
      })) {
        return [];
      }
      const hits = await rankLanceDb({
        lancedbInfo: idx.lancedb,
        queryEmbedding: embedding,
        topN: resolvedTopN,
        candidateSet,
        config: lancedbConfig
      });
      if (signal?.aborted) return [];
      if (hits.length && lanceAnnUsed && mode in lanceAnnUsed) {
        lanceAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
