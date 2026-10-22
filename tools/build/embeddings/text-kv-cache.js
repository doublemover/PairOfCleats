import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveCacheBase } from './cache.js';

const PROFILE_DB_FILE = 'text-vectors.sqlite';
const DEFAULT_MAX_ENTRIES = 500000;
const PRUNE_INTERVAL_WRITES = 512;
const VECTOR_ENCODING_FLOAT32 = 'float32';
const VECTOR_ENCODING_FLOAT16 = 'float16';
const VECTOR_ROW_VERSION = 2;

const FLOAT32_BITS_VIEW = new Uint32Array(1);
const FLOAT32_VALUE_VIEW = new Float32Array(FLOAT32_BITS_VIEW.buffer);

const isVectorLike = (value) => (
  Array.isArray(value)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

const toFloat32Copy = (value) => {
  if (!isVectorLike(value) || !value.length) return null;
  if (value instanceof Float32Array) return new Float32Array(value);
  return Float32Array.from(value);
};

export const normalizePersistentTextVectorEncoding = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === VECTOR_ENCODING_FLOAT16 || normalized === 'f16' || normalized === 'fp16' || normalized === 'half') {
    return VECTOR_ENCODING_FLOAT16;
  }
  return VECTOR_ENCODING_FLOAT32;
};

const float32ToFloat16Bits = (value) => {
  FLOAT32_VALUE_VIEW[0] = Number(value);
  const bits = FLOAT32_BITS_VIEW[0] >>> 0;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;

  if (exponent === 0xff) {
    if (mantissa !== 0) return sign | 0x7e00;
    return sign | 0x7c00;
  }

  let halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) {
    return sign | 0x7c00;
  }

  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign;
    const subnormalMantissa = mantissa | 0x800000;
    const shift = 14 - halfExponent;
    let halfMantissa = subnormalMantissa >>> shift;
    const roundBit = (subnormalMantissa >>> (shift - 1)) & 1;
    const stickyMask = (1 << (shift - 1)) - 1;
    const stickyBits = subnormalMantissa & stickyMask;
    if (roundBit && (stickyBits !== 0 || (halfMantissa & 1) !== 0)) {
      halfMantissa += 1;
    }
    // Subnormal rounding can carry into the minimum normal half (0x0400).
    return sign | halfMantissa;
  }

  let halfMantissa = mantissa >>> 13;
  const roundBit = (mantissa >>> 12) & 1;
  const stickyBits = mantissa & 0x0fff;
  if (roundBit && (stickyBits !== 0 || (halfMantissa & 1) !== 0)) {
    halfMantissa += 1;
    if (halfMantissa === 0x0400) {
      halfMantissa = 0;
      halfExponent += 1;
      if (halfExponent >= 0x1f) {
        return sign | 0x7c00;
      }
    }
  }
  return sign | ((halfExponent & 0x1f) << 10) | (halfMantissa & 0x03ff);
};

const float16BitsToFloat32 = (bits) => {
  const sign = (bits & 0x8000) << 16;
  const exponent = (bits >>> 10) & 0x1f;
  let mantissa = bits & 0x03ff;
  let outBits = 0;

  if (exponent === 0) {
    if (mantissa === 0) {
      outBits = sign;
    } else {
      let exp = -14;
      while ((mantissa & 0x0400) === 0) {
        mantissa <<= 1;
        exp -= 1;
      }
      mantissa &= 0x03ff;
      outBits = sign | ((exp + 127) << 23) | (mantissa << 13);
    }
  } else if (exponent === 0x1f) {
    outBits = sign | 0x7f800000 | (mantissa << 13);
  } else {
    outBits = sign | ((exponent + 112) << 23) | (mantissa << 13);
  }

  FLOAT32_BITS_VIEW[0] = outBits >>> 0;
  return FLOAT32_VALUE_VIEW[0];
};

const encodeVectorBlob = (vector, vectorEncoding) => {
  if (!(vector instanceof Float32Array) || !vector.length) return null;
  if (vectorEncoding === VECTOR_ENCODING_FLOAT16) {
    const out = new Uint16Array(vector.length);
    for (let i = 0; i < vector.length; i += 1) {
      out[i] = float32ToFloat16Bits(vector[i]);
      if ((out[i] & 0x7c00) === 0x7c00) return null;
    }
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  }
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
};

const decodeFloat32Blob = (buffer, length) => {
  if ((length * Float32Array.BYTES_PER_ELEMENT) > buffer.byteLength) return null;
  try {
    const view = new Float32Array(buffer.buffer, buffer.byteOffset, length);
    return new Float32Array(view);
  } catch {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = view.getFloat32(i * Float32Array.BYTES_PER_ELEMENT, true);
    }
    return out;
  }
};

const decodeFloat16Blob = (buffer, length) => {
  if ((length * Uint16Array.BYTES_PER_ELEMENT) > buffer.byteLength) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = float16BitsToFloat32(view.getUint16(i * Uint16Array.BYTES_PER_ELEMENT, true));
  }
  return out;
};

const vectorDigest = (buffer, dims, encoding) => createHash('sha256')
  .update(`${VECTOR_ROW_VERSION}\n${encoding}\n${dims}\n${buffer.byteLength}\n`).update(buffer).digest('hex');

const decodeVectorRow = (row, expectedEncoding, expectedDims) => {
  const buffer = row?.vectorBlob;
  if (!(buffer instanceof Uint8Array) || row.formatVersion !== VECTOR_ROW_VERSION
    || row.vectorEncoding !== expectedEncoding || !Number.isSafeInteger(row.dims) || row.dims <= 0
    || (expectedDims && row.dims !== expectedDims)) return null;
  const width = expectedEncoding === VECTOR_ENCODING_FLOAT16 ? 2 : 4;
  if (buffer.byteLength !== row.dims * width || row.payloadBytes !== buffer.byteLength
    || row.payloadSha256 !== vectorDigest(buffer, row.dims, expectedEncoding)) return null;
  const vector = expectedEncoding === VECTOR_ENCODING_FLOAT16
    ? decodeFloat16Blob(buffer, row.dims) : decodeFloat32Blob(buffer, row.dims);
  return vector?.every(Number.isFinite) ? vector : null;
};

const buildCacheKey = (identityKey, text, encoding) => sha1(`${identityKey}\ntext-vectors@${VECTOR_ROW_VERSION}:${encoding}\n${text}`);

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
 *  vectorEncoding?:string,
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
  vectorEncoding = VECTOR_ENCODING_FLOAT32,
  log = null
} = {}) => {
  if (!Database || !cacheRoot || !cacheIdentity || !cacheIdentityKey) return null;
  const maxRows = resolveMaxEntries(maxEntries);
  const resolvedVectorEncoding = normalizePersistentTextVectorEncoding(vectorEncoding);
  const expectedDims = Number.isSafeInteger(cacheIdentity.dims) && cacheIdentity.dims > 0 ? cacheIdentity.dims : null;
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
        format_version INTEGER,
        vector_encoding TEXT,
        payload_bytes INTEGER,
        payload_sha256 TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_access_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_text_vectors_last_access
      ON text_vectors(last_access_at);
    `);
    // Legacy rows remain available to older writers, but never acquire guessed
    // dtype/provenance. New keys and nullable metadata make their invalidation
    // conservative while allowing a normal successful inference to replace them.
    const columns = new Set(db.prepare('PRAGMA table_info(text_vectors)').all().map(row => row.name));
    for (const [name, type] of [['format_version', 'INTEGER'], ['vector_encoding', 'TEXT'],
      ['payload_bytes', 'INTEGER'], ['payload_sha256', 'TEXT']]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE text_vectors ADD COLUMN ${name} ${type}`);
    }
  } catch (err) {
    try { db?.close?.(); } catch {}
    if (typeof log === 'function') {
      log(`[embeddings] persistent text cache disabled (sqlite init failed): ${err?.message || err}`);
    }
    return null;
  }

  const getStmt = db.prepare(`
    SELECT vector_blob AS vectorBlob, dims AS dims, format_version AS formatVersion,
      vector_encoding AS vectorEncoding, payload_bytes AS payloadBytes, payload_sha256 AS payloadSha256
    FROM text_vectors
    WHERE cache_key = ?
  `);
  const touchStmt = db.prepare(`
    UPDATE text_vectors
    SET last_access_at = ?, hit_count = hit_count + ?
    WHERE cache_key = ?
  `);
  const upsertStmt = db.prepare(`
    INSERT INTO text_vectors (
      cache_key,
      dims,
      vector_blob,
      format_version,
      vector_encoding,
      payload_bytes,
      payload_sha256,
      created_at,
      updated_at,
      last_access_at,
      hit_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(cache_key) DO UPDATE SET
      dims = excluded.dims,
      vector_blob = excluded.vector_blob,
      format_version = excluded.format_version,
      vector_encoding = excluded.vector_encoding,
      payload_bytes = excluded.payload_bytes,
      payload_sha256 = excluded.payload_sha256,
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
    errors: 0,
    transactions: 0, writesAvoided: 0, touchesCoalesced: 0, queueLatencyMs: 0
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
      persistedDigests.clear();
      counters.prunes += overflow;
    } catch {
      counters.errors += 1;
    }
  };

  const pendingWrites = new Map(), pendingTouches = new Map(), persistedDigests = new Map();
  const MAX_PENDING_KEYS = 256, MAX_PENDING_BYTES = 4 * 1024 * 1024, MAX_TOUCH_KEYS = 1024;
  let pendingBytes = 0, flushTimer = null, touchTimer = null, closed = false;
  const rememberDigest = (key, digest) => {
    persistedDigests.delete(key); persistedDigests.set(key, digest);
    while (persistedDigests.size > 4096) persistedDigests.delete(persistedDigests.keys().next().value);
  };
  const writeTx = db.transaction((writes, touches) => {
    for (const [key, entry] of writes) upsertStmt.run(key, entry.dims, entry.vectorBlob,
      VECTOR_ROW_VERSION, resolvedVectorEncoding, entry.vectorBlob.byteLength, entry.payloadSha256,
      entry.now, entry.now, entry.now);
    for (const [key, entry] of touches) touchStmt.run(entry.now, entry.count, key);
  });
  const flush = () => {
    clearTimeout(flushTimer); clearTimeout(touchTimer); flushTimer = null; touchTimer = null;
    if (!pendingWrites.size && !pendingTouches.size) return true;
    const writes = Array.from(pendingWrites), touches = Array.from(pendingTouches);
    try {
      writeTx(writes, touches); counters.transactions++;
      for (const [key, entry] of writes) {
        counters.writes++; counters.queueLatencyMs += Date.now() - entry.queuedAt;
        rememberDigest(key, entry.payloadSha256); maybePrune();
      }
      pendingWrites.clear(); pendingTouches.clear(); pendingBytes = 0;
      return true;
    } catch {
      // Cache persistence is advisory. A failed transaction must never advertise
      // a persisted digest, retain an unbounded queue, or fail the index build.
      counters.errors++; pendingWrites.clear(); pendingTouches.clear(); pendingBytes = 0;
      return false;
    }
  };
  const scheduleFlush = () => {
    if (!flushTimer) { flushTimer = setTimeout(flush, 25); flushTimer.unref?.(); }
  };
  const touch = key => {
    const prior = pendingTouches.get(key);
    if (prior) { prior.count++; prior.now = new Date().toISOString(); counters.touchesCoalesced++; }
    else pendingTouches.set(key, { now: new Date().toISOString(), count: 1 });
    if (pendingTouches.size >= MAX_TOUCH_KEYS) flush();
    else if (!touchTimer) { touchTimer = setTimeout(flush, 1000); touchTimer.unref?.(); }
  };
  const store = {
    get(text) {
      if (closed || typeof text !== 'string' || !text.length) return null;
      const key = buildCacheKey(cacheIdentityKey, text, resolvedVectorEncoding);
      try {
        const queued = pendingWrites.get(key);
        const row = queued ? { ...queued, formatVersion: VECTOR_ROW_VERSION, vectorEncoding: resolvedVectorEncoding,
          payloadBytes: queued.vectorBlob.byteLength } : getStmt.get(key);
        if (!row || !row.vectorBlob) {
          persistedDigests.delete(key);
          counters.misses += 1;
          return null;
        }
        const vector = decodeVectorRow(row, resolvedVectorEncoding, expectedDims);
        if (!vector || !vector.length) {
          counters.misses += 1;
          return null;
        }
        counters.hits += 1;
        if (!queued) rememberDigest(key, row.payloadSha256);
        touch(key);
        return vector;
      } catch {
        counters.errors += 1;
        return null;
      }
    },
    set(text, vector) {
      if (closed || typeof text !== 'string' || !text.length) return false;
      const normalized = toFloat32Copy(vector);
      if (!normalized || !normalized.length || (expectedDims && normalized.length !== expectedDims)
        || !normalized.every(Number.isFinite)) return false;
      const key = buildCacheKey(cacheIdentityKey, text, resolvedVectorEncoding);
      const now = new Date().toISOString();
      const encodedVector = encodeVectorBlob(normalized, resolvedVectorEncoding);
      if (!encodedVector) return false;
      const digest = vectorDigest(encodedVector, normalized.length, resolvedVectorEncoding);
      if (pendingWrites.get(key)?.payloadSha256 === digest || persistedDigests.get(key) === digest) {
        counters.writesAvoided++; return true;
      }
      const bytes = encodedVector.byteLength + key.length * 2 + 192;
      if (pendingWrites.size >= MAX_PENDING_KEYS || pendingBytes + bytes > MAX_PENDING_BYTES) flush();
      const prior = pendingWrites.get(key);
      if (prior) pendingBytes -= prior.bytes;
      pendingWrites.set(key, { dims: normalized.length, vectorBlob: encodedVector, payloadSha256: digest,
        now, queuedAt: Date.now(), bytes }); pendingBytes += bytes;
      // A single large row remains supported, but never retained beyond set().
      if (bytes > MAX_PENDING_BYTES) return flush();
      scheduleFlush();
      return true;
    },
    getMany(texts) { return new Map([...new Set(texts)].map(text => [text, this.get(text)])); },
    setMany(entries) { for (const [text, vector] of entries) this.set(text, vector); return flush(); },
    flush,
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
        vectorEncoding: resolvedVectorEncoding,
        pendingWrites: pendingWrites.size, pendingTouches: pendingTouches.size, pendingBytes,
        size: this.size()
      };
    },
    async close() {
      if (closed) return;
      flush(); closed = true; persistedDigests.clear();
      try {
        db?.close?.();
      } catch {
        counters.errors += 1;
      }
    }
  };
  return store;
};
