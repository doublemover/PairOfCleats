import { quantizeEmbeddingVector } from '../../shared/embedding-utils.js';

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
  const arr = Uint8Array.from(values || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
