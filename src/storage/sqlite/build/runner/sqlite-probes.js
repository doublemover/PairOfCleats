import { toArray } from '../../../../shared/iterables.js';

/**
 * Read grouped row counts by mode from existing sqlite db.
 * @param {{Database:any,dbPath:string}} input
 * @returns {Record<string,number>}
 */
export const readSqliteCounts = ({ Database, dbPath }) => {
  const counts = {};
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db.prepare('SELECT mode, COUNT(*) AS total FROM chunks GROUP BY mode').all();
    for (const row of toArray(rows)) {
      if (!row?.mode) continue;
      counts[row.mode] = Number.isFinite(row.total) ? row.total : 0;
    }
  } catch {}
  if (db) {
    try {
      db.close();
    } catch {}
  }
  return counts;
};

/**
 * Read row count for a single mode from existing sqlite db.
 * Returns null when db/table is unreadable.
 * @param {{Database:any,dbPath:string,mode:string}} input
 * @returns {number|null}
 */
export const readSqliteModeCount = ({ Database, dbPath, mode }) => {
  if (!dbPath || !mode) return null;
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(mode);
    return Number.isFinite(row?.total) ? row.total : 0;
  } catch {
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
export const hasVectorTableAtPath = ({ Database, dbPath, tableName, hasVectorTable }) => {
  if (!dbPath || !tableName) return false;
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    return hasVectorTable(db, tableName);
  } catch {
    return false;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
};

/**
 * Resolve expected dense vector count from index pieces payload.
 * @param {object|null|undefined} denseVec
 * @returns {number}
 */
export const resolveExpectedDenseCount = (denseVec) => {
  if (!denseVec || typeof denseVec !== 'object') return 0;
  const fields = denseVec.fields && typeof denseVec.fields === 'object' ? denseVec.fields : null;
  const fromCount = Number(denseVec.count ?? fields?.count);
  if (Number.isFinite(fromCount) && fromCount > 0) return Math.floor(fromCount);
  const fromTotalRecords = Number(denseVec.totalRecords ?? fields?.totalRecords);
  if (Number.isFinite(fromTotalRecords) && fromTotalRecords > 0) return Math.floor(fromTotalRecords);
  const vectors = denseVec.vectors ?? denseVec.arrays?.vectors;
  if (Array.isArray(vectors) && vectors.length > 0) return vectors.length;
  return 0;
};
