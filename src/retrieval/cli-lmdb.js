import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../storage/lmdb/schema.js';
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

  if (!useLmdb) {
    return { useLmdb, dbCode, dbProse, isAvailable: false };
  }

  if (!open) {
    const message = 'lmdb is required for the LMDB backend. Run npm install first.';
    if (backendForcedLmdb) {
      throw new Error(message);
    }
    console.warn(message);
    useLmdb = false;
    return { useLmdb, dbCode, dbProse, isAvailable: false };
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
    return { useLmdb, dbCode, dbProse, isAvailable: false };
  }

  const openStore = (storePath, label) => {
    if (!hasLmdbStore(storePath)) return null;
    const db = open({ path: storePath, readOnly: true });
    const validation = validateLmdbSchemaAndMode({
      db,
      label,
      decode: decodeLmdbValue,
      metaKeys: LMDB_META_KEYS,
      schemaVersion: LMDB_SCHEMA_VERSION
    });
    if (!validation.ok) {
      db.close();
      const reason = validation.issues.map((issue) => `lmdb ${issue}`).join('; ');
      if (backendForcedLmdb) {
        throw new Error(`LMDB ${label} invalid: ${reason}`);
      }
      console.warn(`LMDB ${label} invalid: ${reason}`);
      return null;
    }
    return db;
  };

  if (needsCode) dbCode = openStore(lmdbCodePath, 'code');
  if (needsProse) dbProse = openStore(lmdbProsePath, 'prose');
  if ((needsCode && !dbCode) || (needsProse && !dbProse)) {
    if (dbCode) dbCode.close();
    if (dbProse) dbProse.close();
    dbCode = null;
    dbProse = null;
    useLmdb = false;
  }

  return { useLmdb, dbCode, dbProse, isAvailable: Boolean(dbCode || dbProse) };
}
