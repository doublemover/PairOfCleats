import { retainCachePathAccess } from '../shared/cache/repo-access.js';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../storage/lmdb/schema.js';
import { createBackendDisposer } from './cli/backend-disposal.js';
import { createLmdbCloseOwner } from '../storage/lmdb/close.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { acquireNativeReaderStorage } from '../shared/storage/native-reader.js';
import {
  decodeLmdbValue,
  hasLmdbStore,
  validateLmdbSchemaAndMode
} from '../storage/lmdb/utils.js';

let open = null;
try {
  ({ open } = await import('lmdb'));
} catch {}

export async function createLmdbBackend(options) {
  const {
    useLmdb: useLmdbInput,
    needsCode,
    needsProse,
    lmdbCodePath,
    lmdbProsePath,
    backendForcedLmdb,
    lmdbStates
  } = options;
  let useLmdb = useLmdbInput;
  let dbCode = null;
  let dbProse = null;
  const disposers = new Set();
  const dispose = createBackendDisposer(disposers);
  const closeByDb = new Map();
  const nativeCloseOwners = new WeakMap(), storageByDb = new WeakMap();

  if (!useLmdb) {
    return { useLmdb, dbCode, dbProse, isAvailable: false, dispose };
  }

  if (!open) {
    const message = 'lmdb is required for the LMDB backend. Run npm install first.';
    if (backendForcedLmdb) {
      throw new Error(message);
    }
    console.warn(message);
    useLmdb = false;
    return { useLmdb, dbCode, dbProse, isAvailable: false, dispose };
  }

  const isLmdbReady = (mode) => {
    const state = lmdbStates?.[mode] || null;
    const lmdbState = state?.lmdb || null;
    if (!lmdbState) return true;
    return lmdbState.ready !== false && lmdbState.pending !== true;
  };
  const pendingModes = [];
  if (needsCode && !isLmdbReady('code')) pendingModes.push('code');
  if (needsProse && !isLmdbReady('prose')) pendingModes.push('prose');
  if (pendingModes.length) {
    const message = `LMDB ${pendingModes.join(', ')} index marked pending; falling back to file-backed indexes.`;
    if (backendForcedLmdb) {
      throw new Error(message);
    }
    console.warn(message);
    useLmdb = false;
    return { useLmdb, dbCode, dbProse, isAvailable: false, dispose };
  }

  const openStore = async (storePath, label) => {
    retainCachePathAccess(storePath);
    let db = null;
    const storageContext = options.storageContext ? { ...options.storageContext, nativeBackend: 'lmdb', nativeMode: label,
      nativePublicationIdentity: typeof lmdbStates?.[label]?.buildId === 'string' ? lmdbStates[label].buildId : null } : null;
    const storage = acquireNativeReaderStorage(storePath, storageContext, () => nativeCloseOwners.get(db)?.isSettled() === true);
    try {
      if (!hasLmdbStore(storePath)) { storage?.releaseAfterClosure(); return null; }
      storage?.start();
      db = open({ path: storePath, readOnly: true });
    } catch (error) { storage?.failedOpen(error); throw error; }
    if (storage) {
      if (!storageByDb.has(db)) storageByDb.set(db, new Set());
      storageByDb.get(db).add(storage);
    }
    if (!closeByDb.has(db)) {
      let originalClose, captureFailure, captureFailed = false;
      const close = createBackendDisposer(new Set([async () => {
        const leases = storageByDb.get(db) || [];
        try {
          if (captureFailed) throw addStorageFailureContext(captureFailure, {
            cacheOwnershipPending: true, cacheOwnershipReleased: () => false
          }, null, { forceAggregate: true });
          await nativeCloseOwners.get(db).close();
        } catch (error) {
          let failure = error;
          for (const lease of leases) failure = lease.retainFailure(failure);
          throw failure;
        }
        const errors = [];
        for (const lease of leases) {
          try { lease.releaseAfterClosure(); } catch (error) { errors.push(error); }
        }
        if (errors.length) {
          let failure = errors[0];
          for (const error of errors.slice(1)) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
          throw failure;
        }
      }]));
      closeByDb.set(db, close);
      disposers.add(close);
      try {
        originalClose = db.close;
        if (typeof originalClose !== 'function') throw new TypeError('LMDB requires its original close method.');
        nativeCloseOwners.set(db, createLmdbCloseOwner(db, originalClose));
      } catch (error) { captureFailed = true; captureFailure = error; throw error; }
    }
    const validation = validateLmdbSchemaAndMode({
      db,
      label,
      decode: decodeLmdbValue,
      metaKeys: LMDB_META_KEYS,
      schemaVersion: LMDB_SCHEMA_VERSION
    });
    if (!validation.ok) {
      const reason = validation.issues.map((issue) => `lmdb ${issue}`).join('; ');
      const invalid = new Error(`LMDB ${label} invalid: ${reason}`);
      try { await closeByDb.get(db)(); }
      catch (cleanupError) { throw addStorageFailureContext(invalid, {}, cleanupError, { secondaryPresent: true }); }
      if (backendForcedLmdb) {
        throw invalid;
      }
      console.warn(`LMDB ${label} invalid: ${reason}`);
      return null;
    }
    return db;
  };

  try {
    if (needsCode) dbCode = await openStore(lmdbCodePath, 'code');
    if (needsProse) dbProse = await openStore(lmdbProsePath, 'prose');
    if ((needsCode && !dbCode) || (needsProse && !dbProse)) {
      await dispose();
      dbCode = null;
      dbProse = null;
      useLmdb = false;
    }
    return { useLmdb, dbCode, dbProse, isAvailable: Boolean(dbCode || dbProse), dispose };
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw addStorageFailureContext(error, {}, cleanupError, { secondaryPresent: true }); }
    throw error;
  }
}
