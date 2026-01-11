import { chunkArray } from '../utils.js';

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
  for (const chunk of chunkArray(docIds)) {
    const placeholders = chunk.map(() => '?').join(',');
    for (const target of deleteTargets) {
      const withMode = target.withMode !== false;
      const values = target.transform ? chunk.map(target.transform) : chunk;
      const where = withMode
        ? `mode = ? AND ${target.column} IN (${placeholders})`
        : `${target.column} IN (${placeholders})`;
      const stmt = db.prepare(`DELETE FROM ${target.table} WHERE ${where}`);
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
