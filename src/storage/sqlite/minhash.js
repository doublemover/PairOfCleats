import { MINHASH_HASH_IDENTITY, assertMinhashHashIdentity, normalizeMinhashSampling } from '../../index/minhash.js';
import { CREATE_MINHASH_META_SQL } from './schema.js';

const invalidSampling = () => Object.assign(new Error('Invalid MinHash coordinate metadata; rebuild the index.'),
  { code: 'ERR_ARTIFACT_INVALID', rebuildRequired: true });

export const readSqliteMinhashHeader = (db, mode) => {
  let row;
  try {
    row = db.prepare('SELECT hash_identity, sampling FROM minhash_meta WHERE mode = ?').get(mode);
  } catch (error) {
    if (error?.code === 'SQLITE_ERROR' && /no such (?:table|column)/i.test(error.message)) return null;
    throw error;
  }
  if (!row) return null;
  const hashIdentity = assertMinhashHashIdentity(row.hash_identity);
  let sampling = null;
  if (row.sampling != null) {
    let parsed;
    try { parsed = JSON.parse(row.sampling); } catch { throw invalidSampling(); }
    if (parsed != null) {
      sampling = normalizeMinhashSampling(parsed);
      if (!sampling) throw invalidSampling();
      Object.freeze(sampling);
    }
  }
  return { hashIdentity, sampling };
};

/** Unknown existing rows cannot be relabelled by appending current signatures. */
export const assertSqliteMinhashReceiver = (db, mode) => {
  const columns = db.prepare('PRAGMA table_info(minhash_meta)').all();
  if (columns.length && !columns.some(column => column.name === 'hash_identity')) assertMinhashHashIdentity(null);
  const existing = db.prepare('SELECT 1 AS present FROM minhash_signatures WHERE mode = ? LIMIT 1').get(mode);
  const header = readSqliteMinhashHeader(db, mode);
  if (existing) assertMinhashHashIdentity(header?.hashIdentity);
  return header;
};

export const writeSqliteMinhashHeader = (db, mode, sampling = null) => {
  if (sampling != null && !normalizeMinhashSampling(sampling)) throw invalidSampling();
  db.exec(CREATE_MINHASH_META_SQL);
  db.prepare('INSERT OR REPLACE INTO minhash_meta (mode, hash_identity, sampling) VALUES (?, ?, ?)')
    .run(mode, MINHASH_HASH_IDENTITY, sampling == null ? null : JSON.stringify(sampling));
};
