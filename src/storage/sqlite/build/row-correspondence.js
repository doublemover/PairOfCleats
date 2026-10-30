const SAMPLE_LIMIT = 16;
const tableName = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Native relations are checked within the caller's original read transaction.
 * Bounded witnesses prove failure without hydrating an entire identity Set.
 * Empty manifest entries are valid; hashes/source-generation parity is separate. */
export const readSqliteRowCorrespondence = (db, mode, { annTable = 'dense_vectors_ann', checkAnn = false } = {}) => {
  if (!tableName.test(annTable)) throw new TypeError('SQLite correspondence requires a validated ANN table identifier.');
  if (db.inTransaction !== true) throw new Error('SQLite row correspondence requires its original read transaction.');
  const anomalies = {}, truncated = [];
  const sample = (kind, sql, ...args) => {
    const rows = db.prepare(`${sql} LIMIT ${SAMPLE_LIMIT + 1}`).all(...args);
    anomalies[kind] = rows.slice(0, SAMPLE_LIMIT);
    if (rows.length > SAMPLE_LIMIT) truncated.push(kind);
  };
  sample('denseWithoutChunk', `SELECT d.doc_id AS docId FROM dense_vectors d
    LEFT JOIN chunks c ON c.id = d.doc_id AND c.mode = d.mode
    WHERE d.mode = ? AND c.id IS NULL ORDER BY d.doc_id`, mode);
  sample('chunkWithoutFile', `SELECT c.id AS docId, substr(c.file, 1, 512) AS file FROM chunks c
    LEFT JOIN file_manifest f ON f.mode = c.mode AND f.file = c.file
    WHERE c.mode = ? AND f.file IS NULL ORDER BY c.id`, mode);
  sample('fileChunkCount', `WITH actual AS (SELECT file, COUNT(*) AS count FROM chunks WHERE mode = ? GROUP BY file)
    SELECT substr(f.file, 1, 512) AS file, f.chunk_count AS declaredCount, COALESCE(a.count, 0) AS actualCount
    FROM file_manifest f LEFT JOIN actual a ON a.file = f.file
    WHERE f.mode = ? AND f.chunk_count IS NOT COALESCE(a.count, 0) ORDER BY f.file`, mode, mode);
  if (checkAnn) {
    // The shared toSqliteRowId owner preserves doc_id; no +1 reinterpretation.
    sample('denseWithoutAnn', `SELECT d.doc_id AS docId FROM dense_vectors d
      LEFT JOIN ${annTable} a ON a.rowid = d.doc_id
      WHERE d.mode = ? AND a.rowid IS NULL ORDER BY d.doc_id`, mode);
    sample('annWithoutDense', `SELECT a.rowid AS rowId FROM ${annTable} a
      LEFT JOIN dense_vectors d ON d.mode = ? AND d.doc_id = a.rowid
      WHERE d.doc_id IS NULL ORDER BY a.rowid`, mode);
  }
  return { schemaVersion: 1, ok: Object.values(anomalies).every(rows => rows.length === 0),
    sampleLimit: SAMPLE_LIMIT, truncated, anomalies,
    coverage: { files: 'native-counts-and-membership', dense: 'native-chunk-membership',
      ann: checkAnn ? 'native-dense-membership' : 'not-admitted', sourceHashes: 'unqualified' } };
};
