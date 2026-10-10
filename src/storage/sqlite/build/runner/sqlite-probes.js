import { assertSqliteIndexFormat } from '../../index-format.js';
import { toArray } from '../../../../shared/iterables.js';

/**
 * Read grouped row counts by mode from existing sqlite db.
 * @param {{Database:any,dbPath:string}} input
 * @returns {Record<string,number>}
 */
export const readSqliteCounts = ({ Database, dbPath, repoRoot = process.cwd() }) => {
  const counts = {};
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    assertSqliteIndexFormat({ db, repoRoot, indexPath: dbPath, operation: 'probe' });
    const rows = db.prepare('SELECT mode, COUNT(*) AS total FROM chunks GROUP BY mode').all();
    for (const row of toArray(rows)) {
      if (!row?.mode) continue;
      counts[row.mode] = Number.isFinite(row.total) ? row.total : 0;
    }
  } catch (error) {
    if (error?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
  } finally {
    try { db?.close(); } catch {}
  }
  return counts;
};

/**
 * Read row count for a single mode from existing sqlite db.
 * Returns null when db/table is unreadable.
 * @param {{Database:any,dbPath:string,mode:string}} input
 * @returns {number|null}
 */
export const readSqliteModeCount = ({ Database, dbPath, repoRoot = process.cwd(), mode }) => {
  if (!dbPath || !mode) return null;
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    assertSqliteIndexFormat({ db, repoRoot, indexPath: dbPath, operation: 'probe' });
    const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(mode);
    return Number.isFinite(row?.total) ? row.total : 0;
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
};

/**
 * Read dense vector row count for a single mode from sqlite db.
 * Returns null when db/table is unreadable.
 *
 * @param {{Database:any,dbPath:string,mode:string}} input
 * @returns {number|null}
 */
export const readSqliteDenseModeCount = ({ Database, dbPath, repoRoot = process.cwd(), mode }) => {
  if (!dbPath || !mode) return null;
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    assertSqliteIndexFormat({ db, repoRoot, indexPath: dbPath, operation: 'probe' });
    const row = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get(mode);
    return Number.isFinite(row?.total) ? row.total : 0;
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
};
/**
 * Read total table row count from sqlite db.
 * Returns null when db/table is unreadable.
 *
 * @param {{Database:any,dbPath:string,tableName:string}} input
 * @returns {number|null}
 */
export const readSqliteTableCount = ({ Database, dbPath, repoRoot = process.cwd(), tableName }) => {
  if (!dbPath || !tableName) return null;
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    assertSqliteIndexFormat({ db, repoRoot, indexPath: dbPath, operation: 'probe' });
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get();
    return Number.isFinite(row?.total) ? row.total : 0;
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
};

/**
 * Probe whether vector table exists in sqlite db.
 * @param {{Database:any,dbPath:string,tableName:string,hasVectorTable:(db:any,tableName:string)=>boolean}} input
 * @returns {boolean}
 */
export const hasVectorTableAtPath = ({ Database, dbPath, repoRoot = process.cwd(), tableName, hasVectorTable }) => {
  if (!dbPath || !tableName) return false;
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    assertSqliteIndexFormat({ db, repoRoot, indexPath: dbPath, operation: 'probe' });
    return hasVectorTable(db, tableName);
  } catch (error) {
    if (error?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    return false;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
};
