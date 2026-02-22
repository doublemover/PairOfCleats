import { clampInt } from '../../../shared/limits.js';

const DEFAULT_SQLITE_MAX_VARIABLES = 999;

const normalizeInsertClause = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!normalized) return 'INSERT';
  if (normalized === 'INSERT') return 'INSERT';
  if (normalized === 'INSERT OR REPLACE') return 'INSERT OR REPLACE';
  if (normalized === 'INSERT OR IGNORE') return 'INSERT OR IGNORE';
  return normalized;
};

/**
 * Create a cached multi-row inserter for a single table.
 *
 * Notes:
 * - Designed for throughput on very hot tables (postings) where per-row `stmt.run()` overhead dominates.
 * - Uses cached prepared statements keyed by rowCount to avoid repeated parse/prepare churn.
 * - Batches are capped by SQLite's max variable count (defaults to 999).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} options
 * @param {string} options.table
 * @param {string[]} options.columns
 * @param {string} [options.insertClause] - e.g. "INSERT" or "INSERT OR REPLACE"
 * @param {string} [options.conflictClause] - optional trailing ON CONFLICT clause
 * @param {number} [options.maxVariables]
 * @param {number} [options.maxRows]
 * @param {number[]} [options.dedupeKeyIndices] - column indexes that define row identity
 * @param {number} [options.dedupeSumIndex] - numeric column index summed across deduped rows
 * @param {object} [options.stats]
 * @returns {(rows: any[][]) => void}
 */
export function createMultiRowInserter(db, options = {}) {
  if (!db) throw new Error('[sqlite] createMultiRowInserter: db is required.');
  const table = typeof options.table === 'string' && options.table.trim()
    ? options.table.trim()
    : null;
  if (!table) throw new Error('[sqlite] createMultiRowInserter: table is required.');
  const columns = Array.isArray(options.columns) ? options.columns.filter(Boolean) : [];
  if (!columns.length) throw new Error('[sqlite] createMultiRowInserter: columns are required.');

  const insertClause = normalizeInsertClause(options.insertClause);
  const conflictClause = typeof options.conflictClause === 'string'
    ? options.conflictClause.trim()
    : '';
  const maxVariables = clampInt(
    Number(options.maxVariables) || DEFAULT_SQLITE_MAX_VARIABLES,
    1,
    1000000
  );
  const maxRowsByVars = Math.max(1, Math.floor(maxVariables / columns.length));
  const requestedMaxRows = Number.isFinite(Number(options.maxRows)) ? Math.floor(Number(options.maxRows)) : null;
  const maxRows = requestedMaxRows ? clampInt(requestedMaxRows, 1, maxRowsByVars) : maxRowsByVars;

  const stats = options.stats && typeof options.stats === 'object' ? options.stats : null;
  const multiRowStats = stats ? (stats.multiRow || (stats.multiRow = {})) : null;
  const tableStats = multiRowStats ? (multiRowStats[table] || (multiRowStats[table] = {})) : null;
  if (tableStats) {
    tableStats.maxRows = maxRows;
    tableStats.maxVariables = maxVariables;
  }

  const placeholdersPerRow = `(${columns.map(() => '?').join(',')})`;
  const statementCache = new Map();
  const dedupeKeyIndices = Array.isArray(options.dedupeKeyIndices)
    ? options.dedupeKeyIndices
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < columns.length)
    : null;
  const dedupeSumIndexRaw = Number(options.dedupeSumIndex);
  const dedupeSumIndex = Number.isInteger(dedupeSumIndexRaw)
    && dedupeSumIndexRaw >= 0
    && dedupeSumIndexRaw < columns.length
    ? dedupeSumIndexRaw
    : null;

  const getStatement = (rowCount) => {
    const count = clampInt(rowCount, 1, maxRows);
    const cached = statementCache.get(count);
    if (cached) return cached;
    const placeholders = Array.from({ length: count }, () => placeholdersPerRow).join(',');
    const sql = `${insertClause} INTO ${table} (${columns.join(',')}) VALUES ${placeholders}${conflictClause ? ` ${conflictClause}` : ''}`;
    const stmt = db.prepare(sql);
    statementCache.set(count, stmt);
    if (tableStats) {
      tableStats.prepared = (tableStats.prepared || 0) + 1;
    }
    return stmt;
  };

  const insertRows = (rows) => {
    if (!rows || !rows.length) return;
    const originalRowsLength = rows.length;
    let sourceRows = rows;
    if (dedupeKeyIndices && dedupeKeyIndices.length && dedupeSumIndex !== null && rows.length > 1) {
      const deduped = [];
      const byKey = new Map();
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== columns.length) {
          throw new Error(
            `[sqlite] createMultiRowInserter(${table}): row shape mismatch; ` +
            `expected ${columns.length} values, got ${Array.isArray(row) ? row.length : typeof row}`
          );
        }
        const key = dedupeKeyIndices.map((idx) => String(row[idx])).join('\u001f');
        const seen = byKey.get(key);
        if (seen === undefined) {
          const next = row.slice();
          const value = Number(next[dedupeSumIndex]);
          next[dedupeSumIndex] = Number.isFinite(value) ? value : 0;
          byKey.set(key, deduped.length);
          deduped.push(next);
          continue;
        }
        const merged = deduped[seen];
        const current = Number(merged[dedupeSumIndex]);
        const incoming = Number(row[dedupeSumIndex]);
        merged[dedupeSumIndex] = (Number.isFinite(current) ? current : 0) + (Number.isFinite(incoming) ? incoming : 0);
      }
      sourceRows = deduped;
    }
    if (tableStats) {
      tableStats.inputRows = (tableStats.inputRows || 0) + originalRowsLength;
      tableStats.dedupedRows = (tableStats.dedupedRows || 0) + Math.max(0, originalRowsLength - sourceRows.length);
    }
    let index = 0;
    while (index < sourceRows.length) {
      const remaining = sourceRows.length - index;
      const take = remaining >= maxRows ? maxRows : remaining;
      const stmt = getStatement(take);
      const params = [];
      for (let i = 0; i < take; i += 1) {
        const row = sourceRows[index + i];
        if (!Array.isArray(row) || row.length !== columns.length) {
          throw new Error(
            `[sqlite] createMultiRowInserter(${table}): row shape mismatch; ` +
            `expected ${columns.length} values, got ${Array.isArray(row) ? row.length : typeof row}`
          );
        }
        params.push(...row);
      }
      stmt.run(...params);
      if (tableStats) {
        tableStats.runs = (tableStats.runs || 0) + 1;
        tableStats.rows = (tableStats.rows || 0) + take;
      }
      index += take;
    }
  };

  insertRows.maxRows = maxRows;
  insertRows.getPreparedCount = () => statementCache.size;
  return insertRows;
}
