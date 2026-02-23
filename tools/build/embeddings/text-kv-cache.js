import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveCacheBase } from './cache.js';

const PROFILE_DB_FILE = 'text-vectors.sqlite';
const DEFAULT_MAX_ENTRIES = 500000;
const PRUNE_INTERVAL_WRITES = 512;
const VECTOR_ENCODING_FLOAT32 = 'float32';
const VECTOR_ENCODING_FLOAT16 = 'float16';

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
    return sign | (halfMantissa & 0x03ff);
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

const bufferToFloat32 = (buffer, dims = null) => {
  if (!buffer || !buffer.byteLength) return null;
  const length = Number.isFinite(Number(dims)) && Number(dims) > 0
    ? Math.max(1, Math.floor(Number(dims)))
    : Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  if (!length) return null;
  const float16Bytes = length * Uint16Array.BYTES_PER_ELEMENT;
  const float32Bytes = length * Float32Array.BYTES_PER_ELEMENT;
  if (Number.isFinite(Number(dims)) && Number(dims) > 0) {
    if (buffer.byteLength === float16Bytes) {
      return decodeFloat16Blob(buffer, length);
    }
    if (buffer.byteLength === float32Bytes || buffer.byteLength > float32Bytes) {
      return decodeFloat32Blob(buffer, length);
    }
    return null;
  }
  if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT === 0) {
    return decodeFloat32Blob(buffer, Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT));
  }
  if (buffer.byteLength % Uint16Array.BYTES_PER_ELEMENT === 0) {
    return decodeFloat16Blob(buffer, Math.floor(buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT));
  }
  return null;
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
      const encodedVector = encodeVectorBlob(normalized, resolvedVectorEncoding);
      if (!encodedVector) return false;
      try {
        upsertStmt.run(
          key,
          normalized.length,
          encodedVector,
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
        vectorEncoding: resolvedVectorEncoding,
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
