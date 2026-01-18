import { chunkArray } from '../utils.js';

const deleteStatementCache = new WeakMap();
const TEMP_DELETE_THRESHOLD = 2000;

const getDeleteStatement = (db, key, sql) => {
  let dbCache = deleteStatementCache.get(db);
  if (!dbCache) {
    dbCache = new Map();
    deleteStatementCache.set(db, dbCache);
  }
  let stmt = dbCache.get(key);
  if (!stmt) {
    stmt = db.prepare(sql);
    dbCache.set(key, stmt);
  }
  return stmt;
};

export function deleteDocIds(db, mode, docIds, extraTables = []) {
  if (!docIds.length) return;
  const deleteTargets = [
    { table: 'chunks', column: 'id' },
    { table: 'chunks_fts', column: 'rowid' },
    { table: 'token_postings', column: 'doc_id' },
    { table: 'phrase_postings', column: 'doc_id' },
    { table: 'chargram_postings', column: 'doc_id' },
    { table: 'minhash_signatures', column: 'doc_id' },
    { table: 'dense_vectors', column: 'doc_id' },
    { table: 'doc_lengths', column: 'doc_id' }
  ];
  for (const extra of extraTables) {
    if (extra?.table && extra?.column) deleteTargets.push(extra);
  }
  const hasTransforms = deleteTargets.some((target) => typeof target.transform === 'function');
  if (!hasTransforms && docIds.length >= TEMP_DELETE_THRESHOLD) {
    const tempTable = 'temp_doc_ids';
    try {
      db.exec(`DROP TABLE IF EXISTS ${tempTable}`);
      db.exec(`CREATE TEMP TABLE ${tempTable} (id INTEGER PRIMARY KEY)`);
      const insertStmt = db.prepare(`INSERT OR REPLACE INTO ${tempTable} (id) VALUES (?)`);
      const insertTx = db.transaction((values) => {
        for (const value of values) insertStmt.run(value);
      });
      insertTx(docIds);
      for (const target of deleteTargets) {
        const withMode = target.withMode !== false;
        const where = withMode
          ? `mode = ? AND ${target.column} IN (SELECT id FROM ${tempTable})`
          : `${target.column} IN (SELECT id FROM ${tempTable})`;
        const key = `${target.table}:${target.column}:${withMode ? 'mode' : 'nomode'}:temp`;
        const stmt = getDeleteStatement(db, key, `DELETE FROM ${target.table} WHERE ${where}`);
        if (withMode) {
          stmt.run(mode);
        } else {
          stmt.run();
        }
      }
      return;
    } finally {
      try { db.exec(`DROP TABLE IF EXISTS ${tempTable}`); } catch {}
    }
  }
  for (const chunk of chunkArray(docIds)) {
    const placeholders = chunk.map(() => '?').join(',');
    for (const target of deleteTargets) {
      const withMode = target.withMode !== false;
      const values = target.transform ? chunk.map(target.transform) : chunk;
      const where = withMode
        ? `mode = ? AND ${target.column} IN (${placeholders})`
        : `${target.column} IN (${placeholders})`;
      const key = `${target.table}:${target.column}:${withMode ? 'mode' : 'nomode'}:${chunk.length}`;
      const stmt = getDeleteStatement(db, key, `DELETE FROM ${target.table} WHERE ${where}`);
      if (withMode) {
        stmt.run(mode, ...values);
      } else {
        stmt.run(...values);
      }
    }
  }
}

export function updateTokenStats(db, mode, insertTokenStats) {
  const row = db.prepare(
    'SELECT COUNT(*) AS total_docs, AVG(len) AS avg_doc_len FROM doc_lengths WHERE mode = ?'
  ).get(mode) || {};
  insertTokenStats.run(
    mode,
    typeof row.avg_doc_len === 'number' ? row.avg_doc_len : 0,
    typeof row.total_docs === 'number' ? row.total_docs : 0
  );
}
