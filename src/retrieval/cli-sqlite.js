import { assertSqliteIndexFormat } from '../storage/sqlite/index-format.js';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  hasVectorTable,
  loadVectorExtension,
  resolveVectorExtensionConfigForMode,
  resolveVectorExtensionPath
} from '../../tools/sqlite/vector-extension.js';

import { applyReadPragmas } from '../storage/sqlite/build/pragmas.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { stableStringifyForSignature } from '../shared/stable-json.js';

const sqliteChunkCountCache = new Map();

const buildSqliteGenerationTag = (mode, state = null, generationContext = null) => {
  if (!state || typeof state !== 'object') return null;
  return stableStringifyForSignature({
    mode,
    buildId: state.buildId || null,
    buildGenerationKey: generationContext?.buildGenerationKey || null,
    activeBuildRoot: generationContext?.activeBuildRoot || null,
    artifactSurfaceVersion: state.artifactSurfaceVersion || null,
    profileId: state.profile?.id || null,
    profileSchemaVersion: state.profile?.schemaVersion || null,
    sqliteReady: state.sqlite?.ready ?? null,
    sqlitePending: state.sqlite?.pending ?? null
  });
};

/**
 * Initialize SQLite connections for search.
 * @param {object} options
 * @returns {Promise<{useSqlite:boolean,dbCode:(object|null),dbProse:(object|null),dbExtractedProse:(object|null),vectorAnnState:object,vectorAnnUsed:object,dispose:Function}>}
 */
export async function createSqliteBackend(options) {
  const {
    useSqlite: useSqliteInput,
    needsCode,
    needsProse,
    needsExtractedProse,
    sqliteCodePath,
    sqliteProsePath,
    sqliteExtractedProsePath,
    sqliteFtsRequested,
    backendForcedSqlite,
    vectorExtension,
    vectorAnnEnabled,
    storageTier,
    sqliteReadPragmas,
    dbCache,
    sqliteStates,
    generationContext = null
  } = options;

  let useSqlite = useSqliteInput;
  let dbCode = null;
  let dbProse = null;
  let dbExtractedProse = null;
  const openedByPath = new Map();
  const usesCacheLeases = typeof dbCache?.acquire === 'function'
    && typeof dbCache?.setAndAcquire === 'function';
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const record of openedByPath.values()) {
      try {
        record.cleanup?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Failed to release SQLite backend handles.');
  };
  const vectorAnnState = {
    code: { available: false },
    prose: { available: false },
    records: { available: false },
    'extracted-prose': { available: false }
  };
  const vectorAnnUsed = { code: false, prose: false, records: false, 'extracted-prose': false };
  const resetVectorAnnAvailability = () => {
    for (const mode of Object.keys(vectorAnnState)) {
      const entry = vectorAnnState[mode];
      if (!entry || typeof entry !== 'object') continue;
      entry.available = false;
      delete entry.table;
      delete entry.column;
      delete entry.dims;
      if (Object.prototype.hasOwnProperty.call(vectorAnnUsed, mode)) {
        vectorAnnUsed[mode] = false;
      }
    }
  };
  /**
   * Match index-builder ANN table suffixing behavior.
   * Only code/prose path equality participates in shared-DB table naming.
   * Extracted-prose is intentionally excluded because it may be routed to a
   * separate SQLite file (or fall back to file artifacts) in mixed backends.
   */
  const sharedDb = Boolean(
    sqliteCodePath
    && sqliteProsePath
    && path.resolve(sqliteCodePath) === path.resolve(sqliteProsePath)
  );
  const vectorAnnConfigByMode = {
    code: resolveVectorExtensionConfigForMode(vectorExtension, 'code', { sharedDb }),
    prose: resolveVectorExtensionConfigForMode(vectorExtension, 'prose', { sharedDb }),
    records: vectorExtension,
    'extracted-prose': vectorExtension
  };
  const result = () => ({
    useSqlite,
    dbCode,
    dbProse,
    dbExtractedProse,
    vectorAnnState,
    vectorAnnUsed,
    vectorAnnConfigByMode,
    dispose
  });

  if (!useSqlite) {
    return result();
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
  if (needsExtractedProse && !isSqliteReady('extracted-prose')) pendingModes.push('extracted-prose');
  if (pendingModes.length) {
    const message = `SQLite ${pendingModes.join(', ')} index marked pending; falling back to file-backed indexes.`;
    if (backendForcedSqlite) {
      throw new Error(message);
    }
    console.warn(message);
    useSqlite = false;
    return result();
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
    return result();
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
    // `chunks_fts` is contentless and keyed by `rowid` (joined to chunks.id). Mode filtering happens via `chunks.mode`.
    chunks_fts: ['file', 'name', 'signature', 'kind', 'headline', 'doc', 'tokens'],
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

  const sqlitePathByMode = {
    code: sqliteCodePath ? path.resolve(sqliteCodePath) : null,
    prose: sqliteProsePath ? path.resolve(sqliteProsePath) : null,
    'extracted-prose': sqliteExtractedProsePath ? path.resolve(sqliteExtractedProsePath) : null
  };
  const modeTagsByPath = new Map();
  for (const [mode, dbPath] of Object.entries(sqlitePathByMode)) {
    if (!dbPath) continue;
    const modeTags = modeTagsByPath.get(dbPath) || {};
    modeTags[mode] = buildSqliteGenerationTag(mode, sqliteStates?.[mode], generationContext);
    modeTagsByPath.set(dbPath, modeTags);
  }
  // A cache entry owns a physical handle, so co-resident modes must share one
  // identity. Include configured modes even when this search only needs one:
  // changing any participating generation must invalidate the shared handle.
  const generationTagByPath = new Map();
  for (const [dbPath, modeTags] of modeTagsByPath) {
    const tags = Object.values(modeTags);
    generationTagByPath.set(dbPath, tags.length === 1 ? tags[0] : stableStringifyForSignature(modeTags));
  }
  const openSqlite = (mode) => {
    const dbPath = sqlitePathByMode[mode];
    const label = mode;
    if (openedByPath.has(dbPath)) {
      const record = openedByPath.get(dbPath);
      return record.validated ? record.db : null;
    }
    const generationTag = generationTagByPath.get(dbPath) || null;
    const lease = usesCacheLeases ? dbCache.acquire(dbPath, { generationTag }) : null;
    const cached = usesCacheLeases ? lease?.db : dbCache?.get?.(dbPath, { generationTag });
    if (cached) {
      try { assertSqliteIndexFormat({ db: cached, operation: 'search',
        repoRoot: options.rootDir || options.repoRoot || process.cwd(), indexPath: dbPath });
      } catch (error) { lease?.release(); throw error; }
      openedByPath.set(dbPath, {
        db: cached,
        generationTag,
        cached: true,
        validated: true,
        cleanup: lease ? () => lease.release() : null
      });
      return cached;
    }
    let db;
    let dbStat = null;
    try {
      dbStat = fsSync.statSync(dbPath);
      db = new Database(dbPath, { readonly: true });
      // Own the handle before any operation that can fail, including schema
      // probes and pragmas. Publish only after all modes and ANN are ready.
      openedByPath.set(dbPath, {
        db,
        generationTag,
        cached: false,
        validated: false,
        cleanup: () => db.close()
      });
    } catch (err) {
      const message = 'better-sqlite3 is required for the SQLite backend. Run npm install first.';
      if (backendForcedSqlite) {
        throw new Error(message);
      }
      console.warn(message);
      return null;
    }
    assertSqliteIndexFormat({ db, operation: 'search',
      repoRoot: options.rootDir || options.repoRoot || process.cwd(), indexPath: dbPath });
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = new Set(tableRows.map((row) => row.name));
    const missing = requiredTables.filter((name) => !tableNames.has(name));
    if (missing.length) {
      const message = `SQLite index ${label} is missing required tables (${formatMissingList(missing)}). Rebuild with "pairofcleats index build --stage 4" (or "node build_index.js --stage 4").`;
      if (backendForcedSqlite) {
        throw new Error(message);
      }
      console.warn(`${message} Falling back to file-backed indexes.`);
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
      return null;
    }
    applyReadPragmas(db, {
      dbBytes: dbStat?.size,
      storageTier,
      ...(sqliteReadPragmas && typeof sqliteReadPragmas === 'object' ? sqliteReadPragmas : {})
    });
    openedByPath.get(dbPath).validated = true;
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

  try {
    if (needsCode) dbCode = openSqlite('code');
    if (needsProse) dbProse = openSqlite('prose');
    if (needsExtractedProse) dbExtractedProse = openSqlite('extracted-prose');
    if (needsCode) initVectorAnn(dbCode, 'code');
    if (needsProse) initVectorAnn(dbProse, 'prose');
    if (needsExtractedProse) initVectorAnn(dbExtractedProse, 'extracted-prose');
    if ((needsCode && !dbCode) || (needsProse && !dbProse) || (needsExtractedProse && !dbExtractedProse)) {
      const errors = [];
      for (const [dbPath, record] of openedByPath) {
        if (!record.cached) continue;
        try {
          if (typeof dbCache?.close === 'function') {
            // The expected handle protects replacement generations, including
            // a replacement under an unchanged tag. Legacy caches use get.
            if (usesCacheLeases || dbCache.get?.(dbPath, { generationTag: record.generationTag }) === record.db) {
              dbCache.close(dbPath, { generationTag: record.generationTag, expectedDb: record.db });
            }
          } else if (!usesCacheLeases) {
            record.cleanup = () => record.db.close();
            if (dbCache?.get?.(dbPath) === record.db) dbCache.delete?.(dbPath);
          }
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, 'Failed to clean up SQLite fallback handles.');
      dbCode = null;
      dbProse = null;
      dbExtractedProse = null;
      useSqlite = false;
      // Prevent partially initialized SQLite ANN availability from leaking into
      // file-backed fallback paths.
      resetVectorAnnAvailability();
    } else {
      for (const [dbPath, record] of openedByPath) {
        if (record.cached) continue;
        if (usesCacheLeases) {
          const lease = dbCache.setAndAcquire(dbPath, record.db, { generationTag: record.generationTag });
          record.cleanup = () => lease.release();
          record.cached = true;
        } else if (typeof dbCache?.set === 'function') {
          dbCache.set(dbPath, record.db, { generationTag: record.generationTag });
          record.cleanup = null;
          record.cached = true;
        }
      }
    }
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], error.message, { cause: error });
    }
    throw error;
  }

  return result();
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


    db = new Database(dbPath, { readonly: true });
    assertSqliteIndexFormat({ db, operation: 'probe', repoRoot: process.cwd(), indexPath: dbPath });
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.count;
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
  } catch (error) {
    if (error?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}
