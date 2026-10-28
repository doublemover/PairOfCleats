import { assertSqliteIndexFormat } from '../../index-format.js';
import { toArray } from '../../../../shared/iterables.js';
import { createSqliteCacheCloseOwner } from '../../../../retrieval/sqlite-cache-close-owner.js';
import { acquireNativeReaderStorage } from '../../../../shared/storage/native-reader.js';
import { observeStorageResource } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';
import { readSqliteChunkIdentity } from '../row-identity.js';

// Query unavailability may be reported as an ordinary absent count. Native or
// independent ownership failure may not: close the captured handle first and
// retain the original storage/physical owners whenever settlement is unknown.
export const probeSqlite = ({ Database, dbPath, repoRoot = process.cwd(), userConfig = null, required = false }, read, fallback) => {
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
    if (required || primary?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw primary;
    return fallback;
  }
  return value;
};

/** Read grouped row counts by mode; unavailable queries return an empty map. */
export const readSqliteCounts = input => probeSqlite(input, db => {
  const counts = {};
  const rows = db.prepare('SELECT mode, COUNT(*) AS total FROM chunks GROUP BY mode').all();
  for (const row of toArray(rows)) {
    if (row?.mode) {
      if (!Number.isSafeInteger(row.total) || row.total < 0) throw Object.assign(new Error('SQLite grouped count is unavailable or invalid.'), {
        code: 'ERR_SQLITE_COUNT_UNAVAILABLE'
      });
      counts[row.mode] = row.total;
    }
  }
  return counts;
}, {});

/** Read a mode's row count; unreadable queries return null after known close. */
export const readSqliteModeCount = input => {
  if (!input.dbPath || !input.mode) return null;
  return probeSqlite(input, db => {
    const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(input.mode);
    return Number.isSafeInteger(row?.total) && row.total >= 0 ? row.total : null;
  }, null);
};

/** Read a mode's dense count; unreadable queries return null after known close. */
export const readSqliteDenseModeCount = input => {
  if (!input.dbPath || !input.mode) return null;
  return probeSqlite(input, db => {
    const row = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get(input.mode);
    return Number.isSafeInteger(row?.total) && row.total >= 0 ? row.total : null;
  }, null);
};

/** Read an internal table count; unreadable queries return null after known close. */
export const readSqliteTableCount = input => {
  if (!input.dbPath || !input.tableName) return null;
  return probeSqlite(input, db => {
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ${input.tableName}`).get();
    return Number.isSafeInteger(row?.total) && row.total >= 0 ? row.total : null;
  }, null);
};

/** Required staged ledger counts share one native owner and read transaction.
 * Absence is explicit; a failed query/extension is never a zero or absent table. */
export const readSqliteModeRowCounts = (input, { annTable = 'dense_vectors_ann', configureAnn = null, chunkIdentity = false } = {}) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(annTable)) throw new TypeError('SQLite ledger requires a validated ANN table identifier.');
  return probeSqlite({ ...input, required: true }, db => db.transaction(() => {
    const annPresent = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(annTable));
    if (annPresent && configureAnn) {
      const configured = configureAnn(db);
      observeStorageResource(configured, { phase: 'sqlite-ledger-ann-configuration' }).requireSettled();
      if (configured?.ok !== true) throw Object.assign(new Error('SQLite ledger cannot read the published ANN representation.'), {
        code: 'ERR_SQLITE_LEDGER_ANN_UNAVAILABLE'
      });
    }
    return {
      chunks: db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(input.mode)?.total,
      dense: db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get(input.mode)?.total,
      files: db.prepare('SELECT COUNT(*) AS total FROM file_manifest WHERE mode = ?').get(input.mode)?.total,
      ann: annPresent ? db.prepare(`SELECT COUNT(*) AS total FROM ${annTable}`).get()?.total : null,
      annPresent,
      ...(chunkIdentity ? { chunkIdentity: readSqliteChunkIdentity(db, input.mode) } : {})
    };
  })(), null);
};

/** Probe an internal vector table; unavailable queries return false after close. */
export const hasVectorTableAtPath = input => {
  if (!input.dbPath || !input.tableName) return false;
  return probeSqlite(input, db => input.hasVectorTable(db, input.tableName), false);
};
