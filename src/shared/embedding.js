import crypto from 'node:crypto';

/**
 * Deterministic stub embedding for tests or offline mode.
 * @param {string} text
 * @param {number} dims
 * @returns {number[]}
 */
export function stubEmbedding(text, dims) {
  const safeDims = Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : 512;
  const hash = crypto.createHash('sha256').update(text).digest();
  let seed = 0;
  for (const byte of hash) seed = (seed * 31 + byte) >>> 0;
  const vec = new Array(safeDims);
  let x = seed;
  for (let i = 0; i < safeDims; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    vec[i] = (x / 0xffffffff) * 2 - 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
