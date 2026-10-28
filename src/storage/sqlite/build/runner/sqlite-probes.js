import { assertSqliteIndexFormat } from '../../index-format.js';
import { toArray } from '../../../../shared/iterables.js';
import { createSqliteCacheCloseOwner } from '../../../../retrieval/sqlite-cache-close-owner.js';
import { acquireNativeReaderStorage } from '../../../../shared/storage/native-reader.js';
import { observeStorageResource } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';

// Query unavailability may be reported as an ordinary absent count. Native or
// independent ownership failure may not: close the captured handle first and
// retain the original storage/physical owners whenever settlement is unknown.
export const probeSqlite = ({ Database, dbPath, repoRoot = process.cwd(), userConfig = null }, read, fallback) => {
  let db = null, close = null, nativeClosed = false, failed = false, primary, value = fallback;
  const storage = acquireNativeReaderStorage(dbPath, userConfig ? { repoRoot, userConfig, nativeBackend: 'sqlite' } : null, () => nativeClosed);
  storage?.start();
  try {
    try { db = new Database(dbPath, { readonly: true }); }
    catch (error) { storage?.failedOpen(error); throw error; }
    close = createSqliteCacheCloseOwner(db, { canClose: () => true, onClosed: () => {},
      onNativeClosed: () => { nativeClosed = true; storage?.releaseAfterClosure(); } });
    assertSqliteIndexFormat({ db, repoRoot, indexPath: dbPath, operation: 'probe' });
    value = read(db);
  } catch (error) {
    failed = true; primary = db && storage ? storage.retainFailure(error) : error;
  }
  try { close?.retire(); }
  catch (cleanup) {
    throw failed ? addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }) : cleanup;
  }
  if (failed) {
    observeStorageResource(primary, { phase: 'sqlite-build-probe' }).requireSettled();
    if (primary?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw primary;
    return fallback;
  }
  return value;
};

/** Read grouped row counts by mode; unavailable queries return an empty map. */
export const readSqliteCounts = input => probeSqlite(input, db => {
  const counts = {};
  const rows = db.prepare('SELECT mode, COUNT(*) AS total FROM chunks GROUP BY mode').all();
  for (const row of toArray(rows)) {
    if (row?.mode) counts[row.mode] = Number.isFinite(row.total) ? row.total : 0;
  }
  return counts;
}, {});

/** Read a mode's row count; unreadable queries return null after known close. */
export const readSqliteModeCount = input => {
  if (!input.dbPath || !input.mode) return null;
  return probeSqlite(input, db => {
    const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(input.mode);
    return Number.isFinite(row?.total) ? row.total : 0;
  }, null);
};

/** Read a mode's dense count; unreadable queries return null after known close. */
export const readSqliteDenseModeCount = input => {
  if (!input.dbPath || !input.mode) return null;
  return probeSqlite(input, db => {
    const row = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get(input.mode);
    return Number.isFinite(row?.total) ? row.total : 0;
  }, null);
};

/** Read an internal table count; unreadable queries return null after known close. */
export const readSqliteTableCount = input => {
  if (!input.dbPath || !input.tableName) return null;
  return probeSqlite(input, db => {
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ${input.tableName}`).get();
    return Number.isFinite(row?.total) ? row.total : 0;
  }, null);
};

/** Probe an internal vector table; unavailable queries return false after close. */
export const hasVectorTableAtPath = input => {
  if (!input.dbPath || !input.tableName) return false;
  return probeSqlite(input, db => input.hasVectorTable(db, input.tableName), false);
};
