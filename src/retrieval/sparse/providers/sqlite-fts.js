import { SPARSE_PROVIDER_IDS } from '../types.js';

/**
 * Build sqlite-fts sparse provider.
 * FTS preflight intentionally validates only tables required for FTS execution
 * so partially-migrated sparse artifacts do not mask healthy FTS indexes.
 *
 * @param {{ rankSqliteFts: Function, normalizeScores?: boolean }} input
 * @returns {{ id:string, requireTables:()=>string[], search:Function }}
 */
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
