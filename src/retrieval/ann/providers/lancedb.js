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

  return {
    id: ANN_PROVIDER_IDS.LANCEDB,
    isAvailable: ({ idx, mode, embedding }) => isAnnProviderAvailable({
      embedding,
      enabled: isEnabled,
      backendReady: isBackendReady(idx, mode)
    }),
    query: async ({ idx, mode, embedding, topN, candidateSet, signal }) => {
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
        topN,
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
