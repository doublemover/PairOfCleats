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

export function resolveQuantizationParams(quantization = {}) {
  const minVal = Number.isFinite(quantization?.minVal) ? Number(quantization.minVal) : -1;
  const maxVal = Number.isFinite(quantization?.maxVal) ? Number(quantization.maxVal) : 1;
  const rawLevels = Number(quantization?.levels);
  let levels = Number.isFinite(rawLevels) ? Math.floor(rawLevels) : 256;
  if (!Number.isFinite(levels)) levels = 256;
  if (levels < 2) levels = 2;
  if (levels > 256) levels = 256;
  return { minVal, maxVal, levels };
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
 * @returns {bigint|number|string}
 */
export function toSqliteRowId(value) {
  try {
    return BigInt(value);
  } catch {
    return value;
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
 * Pack uint8 values into a Buffer.
 * @param {Iterable<number>} values
 * @returns {Buffer}
 */
export function packUint8(values) {
  const list = Array.isArray(values) || ArrayBuffer.isView(values)
    ? values
    : Array.from(values || []);
  const clamped = clampQuantizedVectorInPlace(list);
  if (clamped > 0) {
    console.warn(`[sqlite] Uint8 vector values clamped (${clamped} value${clamped === 1 ? '' : 's'}).`);
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
