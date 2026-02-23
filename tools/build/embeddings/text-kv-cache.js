import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveCacheBase } from './cache.js';

const PROFILE_DB_FILE = 'text-vectors.sqlite';
const DEFAULT_MAX_ENTRIES = 500000;
const PRUNE_INTERVAL_WRITES = 512;

const isVectorLike = (value) => (
  Array.isArray(value)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

const toFloat32Copy = (value) => {
  if (!isVectorLike(value) || !value.length) return null;
  if (value instanceof Float32Array) return new Float32Array(value);
  return Float32Array.from(value);
};

const bufferToFloat32 = (buffer, dims = null) => {
  if (!buffer || !buffer.byteLength) return null;
  const length = Number.isFinite(Number(dims)) && Number(dims) > 0
    ? Math.max(1, Math.floor(Number(dims)))
    : Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  if (!length) return null;
  if ((length * Float32Array.BYTES_PER_ELEMENT) > buffer.byteLength) return null;
  const view = new Float32Array(buffer.buffer, buffer.byteOffset, length);
  return new Float32Array(view);
};

const buildCacheKey = (identityKey, text) => sha1(`${identityKey}\n${text}`);

const resolveMaxEntries = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_ENTRIES;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Open a persistent identity-scoped text->vector cache backed by SQLite.
 *
 * The store is keyed by `sha1(identityKey + text)` so vectors never cross
 * embedding identities. Values are stored as compact float32 blobs.
 *
 * @param {{
 *  Database?:any,
 *  cacheRoot?:string,
 *  cacheIdentity?:object|null,
 *  cacheIdentityKey?:string|null,
 *  maxEntries?:number,
 *  log?:(line:string)=>void
 * }} [input]
 * @returns {Promise<{
 *  get:(text:string)=>Float32Array|null,
 *  set:(text:string,vector:ArrayLike<number>)=>boolean,
 *  size:()=>number,
 *  stats:()=>object,
 *  close:()=>Promise<void>
 * }|null>}
 */
export const createPersistentEmbeddingTextKvStore = async ({
  Database = null,
  cacheRoot = null,
  cacheIdentity = null,
  cacheIdentityKey = null,
  maxEntries = DEFAULT_MAX_ENTRIES,
  log = null
} = {}) => {
  if (!Database || !cacheRoot || !cacheIdentity || !cacheIdentityKey) return null;
  const maxRows = resolveMaxEntries(maxEntries);
  const baseDir = resolveCacheBase(cacheRoot, cacheIdentity);
  const dbPath = path.join(baseDir, PROFILE_DB_FILE);
  try {
    await fs.mkdir(baseDir, { recursive: true });
  } catch (err) {
    if (typeof log === 'function') {
      log(`[embeddings] persistent text cache disabled (mkdir failed): ${err?.message || err}`);
    }
    return null;
  }

  let db = null;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS text_vectors (
        cache_key TEXT PRIMARY KEY,
        dims INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_access_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_text_vectors_last_access
      ON text_vectors(last_access_at);
    `);
  } catch (err) {
    try { db?.close?.(); } catch {}
    if (typeof log === 'function') {
      log(`[embeddings] persistent text cache disabled (sqlite init failed): ${err?.message || err}`);
    }
    return null;
  }

  const getStmt = db.prepare(`
    SELECT vector_blob AS vectorBlob, dims AS dims
    FROM text_vectors
    WHERE cache_key = ?
  `);
  const touchStmt = db.prepare(`
    UPDATE text_vectors
    SET last_access_at = ?, hit_count = hit_count + 1
    WHERE cache_key = ?
  `);
  const upsertStmt = db.prepare(`
    INSERT INTO text_vectors (
      cache_key,
      dims,
      vector_blob,
      created_at,
      updated_at,
      last_access_at,
      hit_count
    ) VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(cache_key) DO UPDATE SET
      dims = excluded.dims,
      vector_blob = excluded.vector_blob,
      updated_at = excluded.updated_at,
      last_access_at = excluded.last_access_at
  `);
  const countStmt = db.prepare('SELECT COUNT(*) AS total FROM text_vectors');
  const pruneStmt = db.prepare(`
    DELETE FROM text_vectors
    WHERE cache_key IN (
      SELECT cache_key
      FROM text_vectors
      ORDER BY last_access_at ASC
      LIMIT ?
    )
  `);
  const pruneTx = db.transaction((overflow) => {
    if (overflow > 0) {
      pruneStmt.run(overflow);
    }
  });

  let writesSincePrune = 0;
  const counters = {
    hits: 0,
    misses: 0,
    writes: 0,
    prunes: 0,
    errors: 0
  };

  const maybePrune = () => {
    writesSincePrune += 1;
    if (writesSincePrune < PRUNE_INTERVAL_WRITES) return;
    writesSincePrune = 0;
    try {
      const total = Math.max(0, Number(countStmt.get()?.total || 0));
      const overflow = Math.max(0, total - maxRows);
      if (overflow <= 0) return;
      pruneTx(overflow);
      counters.prunes += overflow;
    } catch {
      counters.errors += 1;
    }
  };

  return {
    get(text) {
      if (typeof text !== 'string' || !text.length) return null;
      const key = buildCacheKey(cacheIdentityKey, text);
      try {
        const row = getStmt.get(key);
        if (!row || !row.vectorBlob) {
          counters.misses += 1;
          return null;
        }
        const vector = bufferToFloat32(row.vectorBlob, row.dims);
        if (!vector || !vector.length) {
          counters.misses += 1;
          return null;
        }
        counters.hits += 1;
        touchStmt.run(new Date().toISOString(), key);
        return vector;
      } catch {
        counters.errors += 1;
        return null;
      }
    },
    set(text, vector) {
      if (typeof text !== 'string' || !text.length) return false;
      const normalized = toFloat32Copy(vector);
      if (!normalized || !normalized.length) return false;
      const key = buildCacheKey(cacheIdentityKey, text);
      const now = new Date().toISOString();
      try {
        upsertStmt.run(
          key,
          normalized.length,
          Buffer.from(normalized.buffer),
          now,
          now,
          now
        );
        counters.writes += 1;
        maybePrune();
        return true;
      } catch {
        counters.errors += 1;
        return false;
      }
    },
    size() {
      try {
        return Math.max(0, Number(countStmt.get()?.total || 0));
      } catch {
        counters.errors += 1;
        return 0;
      }
    },
    stats() {
      return {
        ...counters,
        maxEntries: maxRows,
        size: this.size()
      };
    },
    async close() {
      try {
        db?.close?.();
      } catch {
        counters.errors += 1;
      }
    }
  };
};
