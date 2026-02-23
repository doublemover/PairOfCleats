import { chunkArray, normalizeFilePath } from '../../utils.js';

const NORMALIZED_FILE_EXPR = "lower(replace(file, char(92), '/'))";

/**
 * Ensure a file-key entry exists in the doc-id cache map.
 *
 * @param {Map<string, {file:string,ids:number[]}>} map
 * @param {string} key
 * @param {string} file
 * @returns {{file:string,ids:number[]}}
 */
const ensureExistingIdEntry = (map, key, file) => {
  const existing = map.get(key);
  if (existing) return existing;
  const entry = { file, ids: [] };
  map.set(key, entry);
  return entry;
};

/**
 * Build a doc-id resolver with prefetching and cached batch statements.
 *
 * Invariants:
 * - File keys are normalized (and case-folded on Windows) to keep id reuse
 *   stable across path separator/case variance.
 * - `resolveExistingDocIds` memoizes lookups to avoid repeated sqlite scans in
 *   delete/insert phases.
 * - `orderChangedRecords` prioritizes new files so free-list allocation for
 *   deleted ids remains deterministic.
 *
 * @param {object} input
 * @param {import('better-sqlite3').Database} input.db
 * @param {string} input.mode
 * @param {Array<object>} input.changed
 * @param {string[]} input.deleted
 * @param {number} input.batchSize
 * @param {(rows:number) => void} [input.onBatch]
 * @returns {{
 *   resolveExistingDocIds:(filePath:string) => number[],
 *   orderChangedRecords:(records:Array<object>) => Array<object>
 * }}
 */
export const createIncrementalDocIdResolver = ({
  db,
  mode,
  changed,
  deleted,
  batchSize,
  onBatch
}) => {
  const existingIdsByFile = new Map();
  const isWindows = process.platform === 'win32';
  const normalizedFileExpr = isWindows ? NORMALIZED_FILE_EXPR : 'file';
  const toFileKey = (value) => {
    const normalized = normalizeFilePath(value);
    if (!normalized) return null;
    return isWindows ? normalized.toLowerCase() : normalized;
  };

  const recordRows = (rows = []) => {
    for (const row of rows) {
      const fileKey = toFileKey(row?.file);
      if (!fileKey) continue;
      const entry = ensureExistingIdEntry(
        existingIdsByFile,
        fileKey,
        normalizeFilePath(row.file) || row.file || fileKey
      );
      entry.ids.push(row.id);
    }
  };

  const readDocIdsForFile = db.prepare(
    'SELECT id, file FROM chunks WHERE mode = ? AND file = ? ORDER BY id'
  );
  const readDocIdsForFileCaseFold = isWindows
    ? db.prepare(`SELECT id, file FROM chunks WHERE mode = ? AND ${normalizedFileExpr} = ? ORDER BY id`)
    : null;

  const targetFilesByKey = new Map();
  const addTarget = (filePath) => {
    const normalized = normalizeFilePath(filePath);
    const key = toFileKey(normalized);
    if (!key) return;
    if (!targetFilesByKey.has(key)) {
      targetFilesByKey.set(key, normalized);
    }
  };
  for (const record of changed) {
    addTarget(record?.normalized || record?.file);
  }
  for (const file of deleted) {
    addTarget(file);
  }
  const targetList = Array.from(targetFilesByKey.keys());
  const fileQueryBatch = Math.max(1, Number(batchSize) || 1);

  if (targetList.length) {
    const batchStatementCache = new Map();
    const resolveBatchStatement = (length) => {
      const cached = batchStatementCache.get(length);
      if (cached) return cached;
      const placeholders = new Array(length).fill('?').join(',');
      const stmt = db.prepare(
        `SELECT id, file FROM chunks WHERE mode = ? AND ${normalizedFileExpr} IN (${placeholders}) ORDER BY id`
      );
      batchStatementCache.set(length, stmt);
      return stmt;
    };
    for (const batch of chunkArray(targetList, fileQueryBatch)) {
      const stmt = resolveBatchStatement(batch.length);
      const rows = stmt.all(mode, ...batch);
      recordRows(rows);
      if (typeof onBatch === 'function') {
        onBatch(rows.length);
      }
    }
    for (const [key, filePath] of targetFilesByKey.entries()) {
      ensureExistingIdEntry(existingIdsByFile, key, filePath);
    }
  }

  const resolveExistingDocIds = (filePath) => {
    const normalized = normalizeFilePath(filePath);
    const fileKey = toFileKey(normalized);
    if (!fileKey) return [];
    const cached = existingIdsByFile.get(fileKey);
    if (cached) return cached.ids || [];

    const exactRows = readDocIdsForFile.all(mode, normalized);
    if (exactRows.length) {
      recordRows(exactRows);
      return existingIdsByFile.get(fileKey)?.ids || [];
    }
    if (readDocIdsForFileCaseFold) {
      const foldedRows = readDocIdsForFileCaseFold.all(mode, fileKey);
      if (foldedRows.length) {
        recordRows(foldedRows);
        return existingIdsByFile.get(fileKey)?.ids || [];
      }
    }
    ensureExistingIdEntry(existingIdsByFile, fileKey, normalized || fileKey);
    return [];
  };

  const orderChangedRecords = (records) => {
    const ranked = (records || []).map((record) => {
      const ids = resolveExistingDocIds(record?.normalized);
      return {
        record,
        isNewFile: ids.length === 0
      };
    });
    ranked.sort((a, b) => {
      if (a.isNewFile === b.isNewFile) return 0;
      return a.isNewFile ? -1 : 1;
    });
    return ranked.map((entry) => entry.record);
  };

  return {
    resolveExistingDocIds,
    orderChangedRecords
  };
};
