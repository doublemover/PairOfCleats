let warnedQuantizationClamp = false;

const warnQuantizationClamp = (count, levels) => {
  if (warnedQuantizationClamp) return;
  warnedQuantizationClamp = true;
  const detail = Number.isFinite(count) ? ` (${count} value${count === 1 ? '' : 's'})` : '';
  const lvl = Number.isFinite(levels) ? ` (levels=${levels})` : '';
  console.warn(`[embeddings] Quantization clamped out-of-range vector values${detail}${lvl}.`);
};

const resolveQuantizationLevels = (value) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 256;
  const floored = Math.floor(raw);
  if (!Number.isFinite(floored)) return 256;
  if (floored < 2) return 2;
  if (floored > 256) return 256;
  return floored;
};

/**
 * Quantize a vector into an array of integers.
 * @param {ArrayLike<number>} vec
 * @param {number} [minVal=-1]
 * @param {number} [maxVal=1]
 * @param {number} [levels=256]
 * @returns {number[]}
 */
export const quantizeEmbeddingVector = (vec, minVal = -1, maxVal = 1, levels = 256) => {
  if (!vec || typeof vec.length !== 'number') return [];
  const length = Math.max(0, Math.floor(vec.length));
  if (!length) return [];
  const out = new Array(length);
  const lvl = resolveQuantizationLevels(levels);
  const min = Number(minVal);
  const max = Number(maxVal);
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) {
    return out.fill(0);
  }
  const scale = (lvl - 1) / range;
  const maxQ = lvl - 1;
  let clamped = 0;
  for (let i = 0; i < length; i += 1) {
    const f = Number(vec[i]);
    const q = Math.round(((f - min) * scale));
    if (q <= 0) {
      out[i] = 0;
      clamped += 1;
    } else if (q >= maxQ) {
      out[i] = maxQ;
      clamped += 1;
    } else {
      out[i] = q;
    }
  }
  if (clamped > 0) warnQuantizationClamp(clamped, lvl);
  return out;
};

/**
 * Quantize a vector into a Uint8Array.
 * @param {ArrayLike<number>} vec
 * @param {number} [minVal=-1]
 * @param {number} [maxVal=1]
 * @param {number} [levels=256]
 * @returns {Uint8Array}
 */
export const quantizeEmbeddingVectorUint8 = (vec, minVal = -1, maxVal = 1, levels = 256) => {
  if (!vec || typeof vec !== 'object') return new Uint8Array(0);
  const length = Number.isFinite(vec.length) ? Math.max(0, Math.floor(vec.length)) : 0;
  if (!length) return new Uint8Array(0);

  const lvl = resolveQuantizationLevels(levels);
  const min = Number(minVal);
  const max = Number(maxVal);
  const range = max - min;

  const out = new Uint8Array(length);
  if (!Number.isFinite(range) || range === 0) return out;

  const scale = (lvl - 1) / range;
  const maxQ = lvl - 1;
  let clamped = 0;

  for (let i = 0; i < length; i += 1) {
    const f = vec[i];
    const q = Math.round((Number(f) - min) * scale);
    if (q <= 0) {
      out[i] = 0;
      clamped += 1;
    } else if (q >= maxQ) {
      out[i] = maxQ;
      clamped += 1;
    } else {
      out[i] = q;
    }
  }

  if (clamped > 0) warnQuantizationClamp(clamped, lvl);
  return out;
};

/**
 * Clamp a quantized vector in place.
 * @param {ArrayLike<number>} vec
 * @param {number} [maxValue=255]
 * @returns {number} number of clamped values
 */
export const clampQuantizedVectorInPlace = (vec, maxValue = 255) => {
  if (!vec || typeof vec.length !== 'number') return 0;
  const max = Number.isFinite(maxValue) ? Math.floor(maxValue) : 255;
  let clamped = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const raw = Number(vec[i]);
    let next = raw;
    if (!Number.isFinite(raw) || raw < 0) {
      next = 0;
    } else if (raw > max) {
      next = max;
    }
    if (next !== raw) {
      vec[i] = next;
      clamped += 1;
    }
  }
  return clamped;
};

/**
 * Clamp a list of quantized vectors in place.
 * @param {Array<ArrayLike<number>>} vectors
 * @param {number} [maxValue=255]
 * @returns {number} number of clamped values
 */
export const clampQuantizedVectorsInPlace = (vectors, maxValue = 255) => {
  if (!Array.isArray(vectors)) return 0;
  let clamped = 0;
  for (const vec of vectors) {
    clamped += clampQuantizedVectorInPlace(vec, maxValue);
  }
  if (clamped > 0) warnQuantizationClamp(clamped, maxValue + 1);
  return clamped;
};
