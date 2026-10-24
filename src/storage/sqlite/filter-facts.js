import { resolveFilterExtension, resolveFilterLanguage } from '../../shared/filter/chunk-file-facts.js';
import { normalizeFilePath } from '../../shared/path-normalize.js';
import { throwIfAborted } from '../../shared/abort.js';

export const SQLITE_FILTER_FACTS_VERSION = 1;

// Optional acceleration inside the same immutable database. A missing/invalid
// seal falls back to the original metadata predicate; it never proves absence.
const schema = `
  CREATE TABLE IF NOT EXISTS chunk_filter_facts (
    doc_id INTEGER PRIMARY KEY, mode TEXT NOT NULL, language TEXT NOT NULL,
    extension TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, file_folded TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunk_filter_facts_meta (
    mode TEXT PRIMARY KEY, version INTEGER NOT NULL, row_count INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_filter_language_doc ON chunk_filter_facts(mode, language, doc_id);
  CREATE INDEX IF NOT EXISTS idx_filter_extension_doc ON chunk_filter_facts(mode, extension, doc_id);
  CREATE INDEX IF NOT EXISTS idx_filter_kind_doc ON chunk_filter_facts(mode, kind, doc_id);
  CREATE INDEX IF NOT EXISTS idx_filter_file_doc ON chunk_filter_facts(mode, file, doc_id);
  CREATE TRIGGER IF NOT EXISTS invalidate_filter_facts_insert AFTER INSERT ON chunks BEGIN
    DELETE FROM chunk_filter_facts WHERE doc_id=NEW.id;
    DELETE FROM chunk_filter_facts_meta;
  END;
  CREATE TRIGGER IF NOT EXISTS invalidate_filter_facts_update AFTER UPDATE ON chunks BEGIN
    DELETE FROM chunk_filter_facts WHERE doc_id IN (OLD.id,NEW.id);
    DELETE FROM chunk_filter_facts_meta;
  END;
  CREATE TRIGGER IF NOT EXISTS invalidate_filter_facts_delete AFTER DELETE ON chunks BEGIN
    DELETE FROM chunk_filter_facts WHERE doc_id=OLD.id;
    DELETE FROM chunk_filter_facts_meta;
  END;
  CREATE TRIGGER IF NOT EXISTS invalidate_filter_seal_insert AFTER INSERT ON chunk_filter_facts BEGIN
    DELETE FROM chunk_filter_facts_meta;
  END;
  CREATE TRIGGER IF NOT EXISTS invalidate_filter_seal_update AFTER UPDATE ON chunk_filter_facts BEGIN
    DELETE FROM chunk_filter_facts_meta;
  END;
  CREATE TRIGGER IF NOT EXISTS invalidate_filter_seal_delete AFTER DELETE ON chunk_filter_facts BEGIN
    DELETE FROM chunk_filter_facts_meta;
  END;
`;

const factRow = row => {
  let metaV2;
  try { metaV2 = typeof row.metaV2_json === 'string' ? JSON.parse(row.metaV2_json) : row.metaV2_json; }
  catch (cause) { throw new Error('SQLite filter facts require valid canonical metadata.', { cause }); }
  if (metaV2 != null && (typeof metaV2 !== 'object' || Array.isArray(metaV2)
    || metaV2.chunkId && row.chunk_id && metaV2.chunkId !== row.chunk_id)) {
    throw new Error('SQLite filter facts disagree with canonical chunk metadata.');
  }
  if (!Number.isSafeInteger(row.id) || row.id < 0
    || typeof row.mode !== 'string' || !row.mode) throw new Error('Invalid SQLite filter fact identity.');
  // Use precisely the fields exposed by the SQLite metadata hydrator. A flat
  // incoming `lang` field is not retained by that representation.
  const chunk = { file: row.file, ext: row.ext, metaV2 };
  const file = normalizeFilePath(String(row.file || ''));
  const result = { doc_id: row.id, mode: row.mode, language: resolveFilterLanguage(chunk),
    extension: String(resolveFilterExtension(chunk)).toLowerCase(),
    kind: String(row.kind || '').toLowerCase(), file, file_folded: file.toLowerCase() };
  // SQLite's UTF8 conversion cannot preserve an unpaired UTF16 surrogate.
  // Such input keeps its original metadata and uses the complete predicate.
  return Object.values(result).some(value => typeof value === 'string'
    && (!value.isWellFormed() || value.includes('\0'))) ? null : result;
};

export const createSqliteFilterFactWriter = db => {
  db.exec(schema);
  const insert = db.prepare(`INSERT OR REPLACE INTO chunk_filter_facts
    (doc_id,mode,language,extension,kind,file,file_folded)
    VALUES (@doc_id,@mode,@language,@extension,@kind,@file,@file_folded)`);
  return row => {
    const facts = factRow(row);
    return facts ? insert.run(facts) : null;
  };
};

/** Seal only exact complete ID coverage. Triggers revoke every seal before a
 * subsequent chunk mutation, including mutations made outside this producer.
 */
export const sealSqliteFilterFacts = (db, mode) => {
  const missing = db.prepare(`SELECT 1 FROM chunks c LEFT JOIN chunk_filter_facts f ON f.doc_id=c.id
    WHERE c.mode=? AND (f.doc_id IS NULL OR f.mode<>c.mode) LIMIT 1`).get(mode);
  const orphan = db.prepare(`SELECT 1 FROM chunk_filter_facts f LEFT JOIN chunks c ON c.id=f.doc_id
    WHERE f.mode=? AND (c.id IS NULL OR c.mode<>f.mode) LIMIT 1`).get(mode);
  db.prepare('DELETE FROM chunk_filter_facts_meta WHERE mode=?').run(mode);
  if (missing || orphan) return false;
  const count = db.prepare('SELECT COUNT(*) AS n FROM chunk_filter_facts WHERE mode=?').get(mode).n;
  db.prepare('INSERT INTO chunk_filter_facts_meta(mode,version,row_count) VALUES (?,?,?)')
    .run(mode, SQLITE_FILTER_FACTS_VERSION, count);
  return true;
};

/** Full builders already own complete input preparation. This bounded pass is
 * charged to build work, not hidden inside a cold filter query.
 */
export const rebuildSqliteFilterFacts = async (db, mode, { signal = null } = {}) => {
  const put = createSqliteFilterFactWriter(db);
  db.prepare('DELETE FROM chunk_filter_facts_meta WHERE mode=?').run(mode);
  db.prepare('DELETE FROM chunk_filter_facts WHERE mode=?').run(mode);
  let rows = 0;
  const select = db.prepare(`SELECT id,chunk_id,mode,file,ext,kind,metaV2_json FROM chunks
    WHERE mode=? AND id>? ORDER BY id LIMIT 128`);
  let lastId = -1;
  while (true) {
    throwIfAborted(signal);
    const batch = select.all(mode, lastId);
    if (!batch.length) break;
    for (const row of batch) { put(row); rows++; lastId = row.id; }
    await new Promise(resolve => setImmediate(resolve));
  }
  throwIfAborted(signal);
  return { version: SQLITE_FILTER_FACTS_VERSION, rows, complete: sealSqliteFilterFacts(db, mode) };
};
