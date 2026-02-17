import { SPARSE_PROVIDER_IDS } from '../types.js';

export function createSqliteFtsProvider({ rankSqliteFts, normalizeScores = false }) {
  return {
    id: SPARSE_PROVIDER_IDS.SQLITE_FTS,
    requireTables: () => ['chunks', 'chunks_fts'],
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
