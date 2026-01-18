import fsSync from 'node:fs';
import path from 'node:path';
import { Unpackr } from 'msgpackr';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../storage/lmdb/schema.js';

let open = null;
try {
  ({ open } = await import('lmdb'));
} catch {}

const unpackr = new Unpackr();
const decode = (value) => (value == null ? null : unpackr.unpack(value));

const isStorePresent = (storePath) => {
  if (!storePath || !fsSync.existsSync(storePath)) return false;
  return fsSync.existsSync(path.join(storePath, 'data.mdb'));
};

const validateStore = (db, label) => {
  const version = decode(db.get(LMDB_META_KEYS.schemaVersion));
  if (version !== LMDB_SCHEMA_VERSION) {
    return { ok: false, reason: `lmdb schema mismatch (expected ${LMDB_SCHEMA_VERSION}, got ${version ?? 'missing'})` };
  }
  const mode = decode(db.get(LMDB_META_KEYS.mode));
  if (mode && mode !== label) {
    return { ok: false, reason: `lmdb mode mismatch (expected ${label}, got ${mode})` };
  }
  return { ok: true };
};

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
    if (!isStorePresent(storePath)) return null;
    const db = open({ path: storePath, readOnly: true });
    const validation = validateStore(db, label);
    if (!validation.ok) {
      db.close();
      if (backendForcedLmdb) {
        throw new Error(`LMDB ${label} invalid: ${validation.reason}`);
      }
      console.warn(`LMDB ${label} invalid: ${validation.reason}`);
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
