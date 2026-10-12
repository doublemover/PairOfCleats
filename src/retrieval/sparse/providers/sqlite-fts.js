import { FTS_VARIANT_TABLES } from '../../../storage/sqlite/fts-variants.js';
import { SPARSE_PROVIDER_IDS } from '../types.js';

/**
 * Build sqlite-fts sparse provider.
 * FTS preflight intentionally validates only tables required for FTS execution
 * so partially-migrated sparse artifacts do not mask healthy FTS indexes.
 *
 * @param {{
 *  rankSqliteFts: Function,
 *  normalizeScores?: boolean,
 *  tailLatencyTuning?: boolean,
 *  overfetch?: { rowCap?: number|null, timeBudgetMs?: number|null, chunkSize?: number|null }|null
 * }} input
 * @returns {{ id:string, requireTables:()=>string[], search:Function }}
 */
export function createSqliteFtsProvider({
  rankSqliteFts,
  normalizeScores = false,
  tailLatencyTuning = false,
  overfetch = null
}) {
  const configuredRowCap = overfetch?.rowCap != null && Number.isFinite(Number(overfetch.rowCap))
    ? Math.max(1, Math.floor(Number(overfetch.rowCap)))
    : null;
  const configuredTimeBudgetMs = overfetch?.timeBudgetMs != null && Number.isFinite(Number(overfetch.timeBudgetMs))
    ? Math.max(1, Math.floor(Number(overfetch.timeBudgetMs)))
    : null;
  const configuredChunkSize = overfetch?.chunkSize != null && Number.isFinite(Number(overfetch.chunkSize))
    ? Math.max(1, Math.floor(Number(overfetch.chunkSize)))
    : null;
  return {
    id: SPARSE_PROVIDER_IDS.SQLITE_FTS,
    requireTables: ({ variant = 'unicode61', mode } = {}) => ['chunks', FTS_VARIANT_TABLES[mode === 'code' && variant === 'porter' ? 'unicode61' : variant]],
    search: ({ idx, queryTokens, ftsMatch = null, ftsVariant = 'unicode61', queryAst = null, mode, topN, allowedIds, onDiagnostic, onOverfetch }) => {
      const tuningEnabled = tailLatencyTuning === true;
      const defaultRowCap = tuningEnabled
        ? Math.max(topN * 6, 1200)
        : null;
      const defaultTimeBudgetMs = tuningEnabled ? 90 : null;
      const defaultChunkSize = tuningEnabled
        ? Math.max(64, Math.min(256, Math.floor((configuredRowCap || defaultRowCap || topN) / 6)))
        : null;
      let execution = null;
      let matchesQueryAst = null;
      const hits = rankSqliteFts(idx, queryTokens, mode, topN, normalizeScores, allowedIds, {
        ftsMatch,
        ftsVariant,
        queryAst,
        onEligibility: matcher => { matchesQueryAst = matcher; },
        overfetchRowCap: configuredRowCap || defaultRowCap,
        overfetchTimeBudgetMs: configuredTimeBudgetMs || defaultTimeBudgetMs,
        overfetchChunkSize: configuredChunkSize || defaultChunkSize,
        onExecution: (metadata) => { execution = metadata; },
        onDiagnostic,
        onOverfetch
      });
      return { hits, type: 'fts', execution, matchesQueryAst };
    }
  };
}
