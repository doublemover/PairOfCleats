import crypto from 'node:crypto';

export const DEFAULT_STUB_DIMS = 384;

export const resolveStubDims = (dims) => {
  const parsed = Number(dims);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STUB_DIMS;
  return Math.floor(parsed);
};

/**
 * Deterministic stub embedding for tests or offline mode.
 * @param {string} text
 * @param {number} dims
 * @returns {Float32Array}
 */
export function stubEmbedding(text, dims, normalize = true) {
  const safeDims = resolveStubDims(dims);
  const hash = crypto.createHash('sha256').update(text).digest();
  let seed = 0;
  for (const byte of hash) seed = (seed * 31 + byte) >>> 0;
  const vec = new Float32Array(safeDims);
  let x = seed;
  for (let i = 0; i < safeDims; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    vec[i] = (x / 0xffffffff) * 2 - 1;
  }
  if (!normalize) {
    return vec;
  }
  let norm = 0;
  for (let i = 0; i < safeDims; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < safeDims; i++) {
    vec[i] = vec[i] / norm;
  }
  return vec;
}
