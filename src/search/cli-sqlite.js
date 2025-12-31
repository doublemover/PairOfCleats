import { hasVectorTable, loadVectorExtension, resolveVectorExtensionPath } from '../../tools/vector-extension.js';

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
    vectorAnnEnabled
  } = options;

  let useSqlite = useSqliteInput;
  let dbCode = null;
  let dbProse = null;
  const vectorAnnState = {
    code: { available: false },
    prose: { available: false },
    records: { available: false }
  };
  const vectorAnnUsed = { code: false, prose: false, records: false };

  if (!useSqlite) {
    return { useSqlite, dbCode, dbProse, vectorAnnState, vectorAnnUsed };
  }

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    console.error('better-sqlite3 is required for the SQLite backend. Run npm install first.');
    process.exit(1);
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

  const openSqlite = (dbPath, label) => {
    const db = new Database(dbPath, { readonly: true });
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = new Set(tableRows.map((row) => row.name));
    const missing = requiredTables.filter((name) => !tableNames.has(name));
    if (missing.length) {
      const message = `SQLite index ${label} is missing required tables (${missing.join(', ')}). Rebuild with npm run build-sqlite-index.`;
      if (backendForcedSqlite) {
        console.error(message);
        process.exit(1);
      }
      console.warn(`${message} Falling back to file-backed indexes.`);
      db.close();
      return null;
    }
    return db;
  };

  let vectorAnnWarned = false;
  const initVectorAnn = (db, mode) => {
    if (!vectorAnnEnabled || !db) return;
    const loadResult = loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
    if (!loadResult.ok) {
      if (!vectorAnnWarned) {
        const extPath = resolveVectorExtensionPath(vectorExtension);
        console.warn(`[ann] SQLite vector extension unavailable (${loadResult.reason}).`);
        console.warn(`[ann] Expected extension at ${extPath || 'unset'}; falling back to JS ANN.`);
        vectorAnnWarned = true;
      }
      return;
    }
    if (!hasVectorTable(db, vectorExtension.table)) {
      if (!vectorAnnWarned) {
        console.warn(`[ann] SQLite vector table missing (${vectorExtension.table}). Rebuild with npm run build-sqlite-index.`);
        vectorAnnWarned = true;
      }
      return;
    }
    vectorAnnState[mode].available = true;
  };

  if (needsCode) dbCode = openSqlite(sqliteCodePath, 'code');
  if (needsProse) dbProse = openSqlite(sqliteProsePath, 'prose');
  if (needsCode) initVectorAnn(dbCode, 'code');
  if (needsProse) initVectorAnn(dbProse, 'prose');
  if ((needsCode && !dbCode) || (needsProse && !dbProse)) {
    if (dbCode) dbCode.close();
    if (dbProse) dbProse.close();
    dbCode = null;
    dbProse = null;
    useSqlite = false;
  }

  return { useSqlite, dbCode, dbProse, vectorAnnState, vectorAnnUsed };
}
