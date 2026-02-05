import fsSync from 'node:fs';
import path from 'node:path';
import {
  hasVectorTable,
  loadVectorExtension,
  resolveVectorExtensionConfigForMode,
  resolveVectorExtensionPath
} from '../../tools/sqlite/vector-extension.js';

import { SCHEMA_VERSION } from '../storage/sqlite/schema.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';

const sqliteChunkCountCache = new Map();

/**
 * Initialize SQLite connections for search.
 * @param {object} options
 * @returns {Promise<{useSqlite:boolean,dbCode:(object|null),dbProse:(object|null),vectorAnnState:object,vectorAnnUsed:object}>}
 */
export async function createSqliteBackend(options) {
  const {
    useSqlite: useSqliteInput,
    needsCode,
    needsProse,
    sqliteCodePath,
    sqliteProsePath,
    sqliteFtsRequested,
    backendForcedSqlite,
    vectorExtension,
    vectorAnnEnabled,
    dbCache,
    sqliteStates
  } = options;

  let useSqlite = useSqliteInput;
  let dbCode = null;
  let dbProse = null;
  const vectorAnnState = {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  };
  const vectorAnnUsed = { code: false, prose: false, records: false, 'extracted-prose': false };
  const sharedDb = sqliteCodePath
    && sqliteProsePath
    && path.resolve(sqliteCodePath) === path.resolve(sqliteProsePath);
  const vectorAnnConfigByMode = {
    code: resolveVectorExtensionConfigForMode(vectorExtension, 'code', { sharedDb }),
    prose: resolveVectorExtensionConfigForMode(vectorExtension, 'prose', { sharedDb }),
    records: vectorExtension,
    'extracted-prose': vectorExtension
  };

  if (!useSqlite) {
    return { useSqlite, dbCode, dbProse, vectorAnnState, vectorAnnUsed };
  }

  const isSqliteReady = (mode) => {
    const state = sqliteStates?.[mode] || null;
    const sqliteState = state?.sqlite || null;
    if (!sqliteState) return true;
    return sqliteState.ready !== false && sqliteState.pending !== true;
  };
  const pendingModes = [];
  if (needsCode && !isSqliteReady('code')) pendingModes.push('code');
  if (needsProse && !isSqliteReady('prose')) pendingModes.push('prose');
  if (pendingModes.length) {
    const message = `SQLite ${pendingModes.join(', ')} index marked pending; falling back to file-backed indexes.`;
    if (backendForcedSqlite) {
      throw new Error(message);
    }
    console.warn(message);
    useSqlite = false;
    return { useSqlite, dbCode, dbProse, vectorAnnState, vectorAnnUsed };
  }

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    const message = 'better-sqlite3 is required for the SQLite backend. Run npm install first.';
    if (backendForcedSqlite) {
      throw new Error(message);
    }
    console.warn(message);
    useSqlite = false;
    return { useSqlite, dbCode, dbProse, vectorAnnState, vectorAnnUsed };
  }

  const requiredTables = sqliteFtsRequested
    ? [
      'chunks',
      'chunks_fts',
      'minhash_signatures',
      'dense_vectors',
      'dense_meta'
    ]
    : [
      'chunks',
      'token_vocab',
      'token_postings',
      'doc_lengths',
      'token_stats',
      'phrase_vocab',
      'phrase_postings',
      'chargram_vocab',
      'chargram_postings',
      'minhash_signatures',
      'dense_vectors',
      'dense_meta'
    ];

  const formatMissingList = (values, max = 8) => {
    if (!Array.isArray(values)) return '';
    if (values.length <= max) return values.join(', ');
    const head = values.slice(0, max).join(', ');
    return `${head}, +${values.length - max} more`;
  };

  const requiredColumnsByTable = {
    chunks: [
      'id',
      'chunk_id',
      'mode',
      'file',
      'start',
      'end',
      'metaV2_json',
      'churn',
      'churn_added',
      'churn_deleted',
      'churn_commits'
    ],
    chunks_fts: ['mode', 'file', 'name', 'signature', 'kind', 'headline', 'doc', 'tokens'],
    token_vocab: ['mode', 'token_id', 'token'],
    token_postings: ['mode', 'token_id', 'doc_id', 'tf'],
    doc_lengths: ['mode', 'doc_id', 'len'],
    token_stats: ['mode', 'avg_doc_len', 'total_docs'],
    phrase_vocab: ['mode', 'phrase_id', 'ngram'],
    phrase_postings: ['mode', 'phrase_id', 'doc_id'],
    chargram_vocab: ['mode', 'gram_id', 'gram'],
    chargram_postings: ['mode', 'gram_id', 'doc_id'],
    minhash_signatures: ['mode', 'doc_id', 'sig'],
    dense_vectors: ['mode', 'doc_id', 'vector'],
    dense_meta: ['mode', 'dims', 'scale', 'model', 'min_val', 'max_val', 'levels']
  };

  const openSqlite = (dbPath, label) => {
    const cached = dbCache?.get?.(dbPath);
    if (cached) return cached;
    let db;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch (err) {
      const message = 'better-sqlite3 is required for the SQLite backend. Run npm install first.';
      if (backendForcedSqlite) {
        throw new Error(message);
      }
      console.warn(message);
      return null;
    }
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = new Set(tableRows.map((row) => row.name));
    const missing = requiredTables.filter((name) => !tableNames.has(name));
    if (missing.length) {
      const message = `SQLite index ${label} is missing required tables (${formatMissingList(missing)}). Rebuild with "pairofcleats index build --stage 4" (or "node build_index.js --stage 4").`;
      if (backendForcedSqlite) {
        throw new Error(message);
      }
      console.warn(`${message} Falling back to file-backed indexes.`);
      db.close();
      return null;
    }
    const columnIssues = [];
    for (const table of requiredTables) {
      const requiredColumns = requiredColumnsByTable[table];
      if (!requiredColumns) continue;
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
      const columnSet = new Set(columns);
      const missingColumns = requiredColumns.filter((col) => !columnSet.has(col));
      if (missingColumns.length) {
        columnIssues.push(`${table} missing columns: ${formatMissingList(missingColumns)}`);
      }
    }
    if (columnIssues.length) {
      const message = `SQLite index ${label} is missing required columns (${columnIssues.join('; ')}). Rebuild with "pairofcleats index build --stage 4" (or "node build_index.js --stage 4").`;
      if (backendForcedSqlite) {
        throw new Error(message);
      }
      console.warn(`${message} Falling back to file-backed indexes.`);
      db.close();
      return null;
    }
    const schemaVersion = db.pragma('user_version', { simple: true });
    if (schemaVersion !== SCHEMA_VERSION) {
      const message = `SQLite schema mismatch for ${label} (expected ${SCHEMA_VERSION}, found ${schemaVersion ?? 'unknown'}).`;
      if (backendForcedSqlite) {
        throw new Error(message);
      }
      console.warn(`${message} Falling back to file-backed indexes.`);
      db.close();
      return null;
    }
    if (dbCache?.set) dbCache.set(dbPath, db);
    return db;
  };

  let vectorAnnWarned = false;
  const initVectorAnn = (db, mode) => {
    if (!vectorAnnEnabled || !db) return;
    const config = vectorAnnConfigByMode[mode] || vectorExtension;
    const loadResult = loadVectorExtension(db, config, `sqlite ${mode}`);
    if (!loadResult.ok) {
      if (!vectorAnnWarned) {
        const extPath = resolveVectorExtensionPath(config);
        console.warn(`[ann] SQLite vector extension unavailable (${loadResult.reason}).`);
        console.warn(`[ann] Expected extension at ${extPath || 'unset'}; falling back to JS ANN.`);
        vectorAnnWarned = true;
      }
      return;
    }
    if (!hasVectorTable(db, config.table)) {
      if (!vectorAnnWarned) {
        console.warn(`[ann] SQLite vector table missing (${config.table}). Rebuild with "pairofcleats index build --stage 4" (or "node build_index.js --stage 4").`);
        vectorAnnWarned = true;
      }
      return;
    }
    vectorAnnState[mode].available = true;
    vectorAnnState[mode].table = config.table;
    vectorAnnState[mode].column = config.column;
  };

  if (needsCode) dbCode = openSqlite(sqliteCodePath, 'code');
  if (needsProse) dbProse = openSqlite(sqliteProsePath, 'prose');
  if (needsCode) initVectorAnn(dbCode, 'code');
  if (needsProse) initVectorAnn(dbProse, 'prose');
  if ((needsCode && !dbCode) || (needsProse && !dbProse)) {
    if (dbCode) dbCache?.close ? dbCache.close(sqliteCodePath) : dbCode.close();
    if (dbProse) dbCache?.close ? dbCache.close(sqliteProsePath) : dbProse.close();
    dbCode = null;
    dbProse = null;
    useSqlite = false;
  }

  return { useSqlite, dbCode, dbProse, vectorAnnState, vectorAnnUsed, vectorAnnConfigByMode };
}

/**
 * Probe SQLite chunk counts for auto-backend selection.
 * @param {string} dbPath
 * @param {'code'|'prose'} mode
 * @returns {Promise<number|null>}
 */
export async function getSqliteChunkCount(dbPath, mode) {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    return null;
  }
  let db;
  let cacheKey = '';
  try {
    const stat = fsSync.statSync(dbPath);
    cacheKey = buildLocalCacheKey({
      namespace: 'sqlite-chunk-count',
      payload: {
        dbPath,
        mode: mode || null
      }
    }).key;
    const cached = sqliteChunkCountCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.count;

    db = new Database(dbPath, { readonly: true });
    const manifestRow = db.prepare('SELECT SUM(chunk_count) as count FROM file_manifest WHERE mode = ?')
      .get(mode);
    if (Number.isFinite(manifestRow?.count)) {
      sqliteChunkCountCache.set(cacheKey, { mtimeMs: stat.mtimeMs, count: manifestRow.count });
      return manifestRow.count;
    }
    const row = db.prepare('SELECT COUNT(*) as count FROM chunks WHERE mode = ?').get(mode);
    const count = typeof row?.count === 'number' ? row.count : null;
    sqliteChunkCountCache.set(cacheKey, { mtimeMs: stat.mtimeMs, count });
    return count;
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}
