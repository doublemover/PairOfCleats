import path from 'node:path';
import { digestSqliteIdentityRows } from './row-identity-digest.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

const witnesses = new WeakMap();
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const vectorFields = ['id', 'mode', 'vector'];
const metaFields = ['id', 'mode', 'dims', 'scale', 'model', 'min_val', 'max_val', 'levels'];
const invalid = message => Object.assign(new Error(message), { code: 'ERR_SQLITE_COMPACTION_VECTOR_IDENTITY' });
const digestVectors = rows => digestSqliteIdentityRows(rows, {
  fields: vectorFields, domain: 'pairofcleats-sqlite-dense-identity-v1\0', blobFields: ['vector']
});
const digestMeta = (db, mode, projectRow = null) => digestSqliteIdentityRows(db.prepare(
  'SELECT 0 AS id, mode, dims, scale, model, min_val, max_val, levels FROM dense_meta WHERE mode = ?').iterate(mode), {
  fields: metaFields, domain: 'pairofcleats-sqlite-dense-meta-identity-v1\0', floatFields: ['scale', 'min_val', 'max_val'], projectRow
});

/** Independent source vector bytes joined to the planned compacted chunk ID.
 * SQL's ordinal covers ALL chunks before joining optional/partial dense rows.
 * No second corpus map, UID uniqueness assumption or doc_id + 1 conversion.
 */
export const captureSqliteCompactionVectorIdentity = (db, mode, { outputPath = db.name, normalizeMeta } = {}) => {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || typeof normalizeMeta !== 'function') {
    throw invalid('Compaction vector identity requires its original output and metadata normalization owner.');
  }
  const expected = db.transaction(() => {
    const counted = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get(mode);
    const observation = observeStorageResource(counted, { phase: 'compaction-source-dense-count' }); observation.requireSettled();
    const count = counted?.total;
    if (!Number.isSafeInteger(count) || count < 0) throw invalid('Compaction source dense count is unavailable.');
    const vectors = digestVectors(db.prepare(`WITH mapped AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY file, start, id) - 1 AS new_id FROM chunks WHERE mode = ?
    ) SELECT m.new_id AS id, d.mode, d.vector FROM mapped m JOIN dense_vectors d ON d.doc_id = m.id AND d.mode = ? ORDER BY m.new_id`).iterate(mode, mode));
    observation.requireSettled();
    if (vectors.count !== count) throw invalid('Compaction source has dense rows without their actual chunks.');
    const meta = digestMeta(db, mode, normalizeMeta);
    observation.requireSettled();
    return Object.freeze({ vectors, meta });
  })();
  const witness = Object.freeze({ schemaVersion: 1, kind: 'sqlite-compaction-vector-identity', mode,
    vectors: expected.vectors, meta: expected.meta, coverage: 'original-dense-bytes-and-normalized-meta-with-planned-chunk-ids' });
  witnesses.set(witness, { target: normalized(outputPath), mode, expected });
  return witness;
};

export const readSqliteCompactedVectorIdentity = (db, mode) => ({
  vectors: digestVectors(db.prepare('SELECT doc_id AS id, mode, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id').iterate(mode)),
  meta: digestMeta(db, mode)
});
export const matchesSqliteCompactionVectorIdentity = (witness, observed, target, mode) => {
  const original = witnesses.get(witness);
  return Boolean(original && original.target === normalized(target) && original.mode === mode
    && ['vectors', 'meta'].every(key => observed?.[key]?.schemaVersion === 1
      && observed[key].count === original.expected[key].count && observed[key].sha256 === original.expected[key].sha256));
};
