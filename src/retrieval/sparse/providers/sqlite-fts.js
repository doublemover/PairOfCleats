import { SPARSE_PROVIDER_IDS } from '../types.js';

export function createSqliteFtsProvider({ rankSqliteFts, normalizeScores = false }) {
  return {
    id: SPARSE_PROVIDER_IDS.SQLITE_FTS,
    search: ({ idx, queryTokens, ftsMatch = null, mode, topN, allowedIds }) => {
      const hits = rankSqliteFts(idx, queryTokens, mode, topN, normalizeScores, allowedIds, { ftsMatch });
      return { hits, type: 'fts' };
    }
  };
}
