import {
  clampQuantizedVectorInPlace,
  quantizeEmbeddingVector
} from '../../shared/embedding-utils.js';

/**
 * Quantize a float vector into uint8 bins for storage.
 * @param {number[]} vec
 * @param {number} [minVal]
 * @param {number} [maxVal]
 * @param {number} [levels]
 * @returns {number[]}
 */
export function quantizeVec(vec, minVal = -1, maxVal = 1, levels = 256) {
  return quantizeEmbeddingVector(vec, minVal, maxVal, levels);
}

/**
 * Dequantize a uint8 vector to Float32Array.
 * @param {ArrayLike<number>} vec
 * @param {number} [minVal]
 * @param {number} [maxVal]
 * @param {number} [levels]
 * @returns {Float32Array|null}
 */
export function dequantizeUint8ToFloat32(vec, minVal = -1, maxVal = 1, levels = 256) {
  if (!vec || typeof vec.length !== 'number') return null;
  const rawLevels = Number(levels);
  let resolvedLevels = Number.isFinite(rawLevels) ? Math.floor(rawLevels) : 256;
  if (!Number.isFinite(resolvedLevels)) resolvedLevels = 256;
  if (resolvedLevels < 2) resolvedLevels = 2;
  if (resolvedLevels > 256) resolvedLevels = 256;
  const scale = (maxVal - minVal) / (resolvedLevels - 1);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] * scale + minVal;
  }
  return out;
}

/**
 * Normalize a vector id to BigInt when possible.
 * @param {string|number|bigint} value
 * @returns {bigint}
 */
export function toSqliteRowId(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string') {
    let text = value.trim();
    if (!text) return 0n;
    if (text.endsWith('n') || text.endsWith('N')) {
      text = text.slice(0, -1).trim();
    }
    if (!text) return 0n;
    if (/^[+-]?\d+$/.test(text)) {
      try {
        return BigInt(text);
      } catch {
        return 0n;
      }
    }
    if (/^[+-]?0[xX][0-9a-fA-F]*$/.test(text)) {
      const sign = text.startsWith('-') ? -1n : 1n;
      const digits = text.replace(/^[+-]?0[xX]/, '');
      if (!digits) return 0n;
      try {
        return sign * BigInt(`0x${digits}`);
      } catch {
        return 0n;
      }
    }
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Pack uint32 values into a Buffer.
 * @param {Iterable<number>} values
 * @returns {Buffer}
 */
export function packUint32(values) {
  const arr = Uint32Array.from(values || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Create clamp statistics collector for bulk uint8 packing.
 * @returns {{totalValues:number,totalVectors:number,record:(clamped:number)=>void}}
 */
export function createUint8ClampStats() {
  return {
    totalValues: 0,
    totalVectors: 0,
    record(clamped) {
      if (!Number.isFinite(clamped) || clamped <= 0) return;
      this.totalValues += clamped;
      this.totalVectors += 1;
    }
  };
}

/**
 * Pack uint8 values into a Buffer.
 * @param {Iterable<number>} values
 * @param {{onClamp?:(clamped:number)=>void}} [options]
 * @returns {Buffer}
 */
export function packUint8(values, options = null) {
  const list = Array.isArray(values) || ArrayBuffer.isView(values)
    ? values
    : Array.from(values || []);
  const clamped = clampQuantizedVectorInPlace(list);
  if (clamped > 0) {
    const onClamp = typeof options?.onClamp === 'function' ? options.onClamp : null;
    if (onClamp) {
      onClamp(clamped);
    } else {
      console.warn(`[sqlite] Uint8 vector values clamped (${clamped} value${clamped === 1 ? '' : 's'}).`);
    }
  }
  const arr = list instanceof Uint8Array ? list : Uint8Array.from(list);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Resolve the expected byte length for an encoded vector.
 * @param {number} dims
 * @param {string} [encoding]
 * @returns {number|null}
 */
export function resolveVectorEncodingBytes(dims, encoding = 'float32') {
  const resolvedDims = Number.isFinite(dims) ? Math.floor(dims) : 0;
  if (!resolvedDims || resolvedDims <= 0) return null;
  const normalized = String(encoding || 'float32').toLowerCase();
  if (normalized === 'json') return null;
  return resolvedDims * 4;
}

/**
 * Resolve the byte length of an encoded vector payload.
 * @param {Buffer|ArrayBuffer|ArrayBufferView|string|ArrayLike<number>|null} encoded
 * @returns {number|null}
 */
export function resolveEncodedVectorBytes(encoded) {
  if (encoded == null) return null;
  if (typeof encoded === 'string') return null;
  if (Buffer.isBuffer(encoded)) return encoded.length;
  if (ArrayBuffer.isView(encoded)) return encoded.byteLength;
  if (encoded instanceof ArrayBuffer) return encoded.byteLength;
  if (typeof encoded.length === 'number') return encoded.length;
  return null;
}

/**
 * Check if encoded vector payload matches the expected size.
 * @param {{encoded:any,dims:number,encoding?:string}} params
 * @returns {boolean}
 */
export function isVectorEncodingCompatible({ encoded, dims, encoding }) {
  if (!encoding) return true;
  const expected = resolveVectorEncodingBytes(dims, encoding);
  if (expected == null) return true;
  const actual = resolveEncodedVectorBytes(encoded);
  if (!Number.isFinite(actual)) return true;
  return actual === expected;
}
