import { SPARSE_PROVIDER_IDS } from '../types.js';
import { resolveSparseRequiredTables } from '../requirements.js';

export function createSqliteFtsProvider({ rankSqliteFts, normalizeScores = false }) {
  return {
    id: SPARSE_PROVIDER_IDS.SQLITE_FTS,
    requireTables: ({ postingsConfig } = {}) => {
      const required = new Set(['chunks_fts']);
      for (const table of resolveSparseRequiredTables(postingsConfig)) {
        required.add(table);
      }
      return Array.from(required.values());
    },
    search: ({ idx, queryTokens, ftsMatch = null, mode, topN, allowedIds, onDiagnostic, onOverfetch }) => {
      const hits = rankSqliteFts(idx, queryTokens, mode, topN, normalizeScores, allowedIds, {
        ftsMatch,
        onDiagnostic,
        onOverfetch
      });
      return { hits, type: 'fts' };
    }
  };
}
