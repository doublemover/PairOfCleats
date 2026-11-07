import { rankLanceDb } from '../../lancedb.js';
import { ANN_PROVIDER_IDS } from '../types.js';
import { canRunAnnQuery, isAnnProviderAvailable } from '../utils.js';
import { throwIfAborted } from '../../../shared/abort.js';

/** @returns {import('../types.js').AnnProvider} */
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
    capabilities: Object.freeze({ predicate: 'partitioned-candidate-id-pushdown', exhaustiveStored: false,
      progressiveEffort: true, cancellation: 'between-native-partitions-and-materialized-row-groups', scoreSpace: 'metadata-declared-distance' }),
    isAvailable: ({ idx, mode, embedding }) => isAnnProviderAvailable({
      embedding,
      enabled: isEnabled,
      backendReady: isBackendReady(idx, mode)
    }),
    query: async ({ idx, mode, embedding, topN, candidateSet, signal, budget }) => {
      throwIfAborted(signal);
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
        config: lancedbConfig,
        signal
      });
      throwIfAborted(signal);
      if (hits.length && lanceAnnUsed && mode in lanceAnnUsed) {
        lanceAnnUsed[mode] = true;
      }
      return hits;
    }
  };
}
