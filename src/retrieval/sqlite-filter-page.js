import { compileFilterPredicates } from './output/filters.js';
import { SQLITE_FILTER_FACTS_VERSION } from '../storage/sqlite/filter-facts.js';
import { throwIfAborted } from '../shared/abort.js';

const supported = new Set(['file', 'ext', 'lang', 'type', 'caseFile', 'caseTokens', 'regexConfig', 'filePrefilter']);
const active = value => value !== null && value !== undefined && value !== false
  && value !== '' && (!Array.isArray(value) || value.length > 0);

/** Optional exact acceleration. Unsupported predicates or an unsealed database
 * return null and keep the original full metadata predicate authoritative.
 * COUNT/substring work can still scan facts; only metadata hydration is paged.
 */
export async function readSqliteFilterFactPage({ db, mode, filters = {}, offset = 0,
  limit, rowCount, signal = null }) {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1
    || !Number.isSafeInteger(rowCount) || rowCount < 0
    || Object.entries(filters).some(([key, value]) => !supported.has(key) && active(value))) return null;
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('chunk_filter_facts','chunk_filter_facts_meta')`).all();
  if (tables.length !== 2) return null;
  const seal = db.prepare('SELECT version,row_count FROM chunk_filter_facts_meta WHERE mode=?').get(mode);
  if (seal?.version !== SQLITE_FILTER_FACTS_VERSION || !Number.isSafeInteger(seal.row_count) || seal.row_count < 0) return null;
  const predicates = compileFilterPredicates(filters);
  if (predicates.fileMatchers.some(matcher => matcher.type !== 'substring')) return null;
  const where = ['mode=?'], params = [mode];
  for (const [column, needles] of [['language', predicates.langNeedles], ['extension', predicates.extNeedles], ['kind', predicates.typeNeedles]]) {
    if (!needles.length) continue;
    if (needles.some(value => !value.isWellFormed() || value.includes('\0'))) return null;
    const encoded = JSON.stringify(needles);
    if (Buffer.byteLength(encoded) > 65536) return null;
    where.push(`${column} IN (SELECT value FROM json_each(?))`); params.push(encoded);
  }
  if (predicates.fileMatchers.length) {
    const needles = predicates.fileMatchers.map(matcher => matcher.value);
    if (needles.some(value => !value.isWellFormed() || value.includes('\0'))
      || Buffer.byteLength(JSON.stringify(needles)) > 65536) return null;
    where.push(`EXISTS (SELECT 1 FROM json_each(?) WHERE instr(${predicates.caseFile ? 'file' : 'file_folded'}, value)>0)`);
    params.push(JSON.stringify(needles));
  }
  // No metadata is decoded while counting, including on a cold cache.
  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM chunk_filter_facts WHERE ${clause}`).get(...params).n;
  throwIfAborted(signal);
  await new Promise(resolve => setImmediate(resolve));
  throwIfAborted(signal);
  const rows = db.prepare(`SELECT doc_id AS id FROM chunk_filter_facts WHERE ${clause}
    ORDER BY doc_id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  if (!Number.isSafeInteger(total) || total < 0 || total > seal.row_count
    || rows.some(row => !Number.isSafeInteger(row.id) || row.id < 0 || row.id >= rowCount)) return null;
  throwIfAborted(signal);
  return { ids: rows.map(row => row.id), total, representation: 'sqlite-indexed-facts', readBytes: 0 };
}
