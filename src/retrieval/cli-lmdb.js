import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../storage/lmdb/schema.js';
import { createBackendDisposer } from './cli/backend-disposal.js';
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
    if (!hasLmdbStore(storePath)) return null;
    const db = open({ path: storePath, readOnly: true });
    if (!closeByDb.has(db)) {
      const close = createBackendDisposer(new Set([() => db.close()]));
      closeByDb.set(db, close);
      disposers.add(close);
    }
    const validation = validateLmdbSchemaAndMode({
      db,
      label,
      decode: decodeLmdbValue,
      metaKeys: LMDB_META_KEYS,
      schemaVersion: LMDB_SCHEMA_VERSION
    });
    if (!validation.ok) {
      await closeByDb.get(db)();
      const reason = validation.issues.map((issue) => `lmdb ${issue}`).join('; ');
      if (backendForcedLmdb) {
        throw new Error(`LMDB ${label} invalid: ${reason}`);
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
    try { await dispose(); } catch {}
    throw error;
  }
}
