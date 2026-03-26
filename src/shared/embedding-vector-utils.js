/**
 * Check whether a value is vector-like (Array or TypedArray view).
 * @param {unknown} value
 * @returns {boolean}
 */
export const isVectorLike = (value) => (
  Array.isArray(value)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

/**
 * Check whether a value is a non-empty vector payload.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isNonEmptyVector = (value) => (
  isVectorLike(value) && value.length > 0
);

/**
 * Count non-empty vectors in an array-like collection.
 * @param {unknown} vectors
 * @returns {number}
 */
export const countNonEmptyVectors = (vectors) => {
  if (!vectors || typeof vectors[Symbol.iterator] !== 'function') return 0;
  let count = 0;
  for (const vector of vectors) {
    if (isNonEmptyVector(vector)) count += 1;
  }
  return count;
};

/**
 * Merge code + doc vectors by averaging corresponding dimensions.
 * Throws when lengths differ.
 *
 * Deterministic: input order is preserved.
 *
 * @param {{ codeVector?: ArrayLike<number>, docVector?: ArrayLike<number> }} options
 * @returns {Float32Array}
 * @throws {Error} when vector lengths differ
 */
export const mergeEmbeddingVectors = ({ codeVector, docVector }) => {
  const code = isVectorLike(codeVector) ? codeVector : [];
  const doc = isVectorLike(docVector) ? docVector : [];
  const codeLen = code.length || 0;
  const docLen = doc.length || 0;
  if (!codeLen && !docLen) return new Float32Array(0);
  if (codeLen && !docLen) {
    return code instanceof Float32Array ? new Float32Array(code) : Float32Array.from(code);
  }
  if (docLen && !codeLen) {
    return doc instanceof Float32Array ? new Float32Array(doc) : Float32Array.from(doc);
  }
  if (codeLen !== docLen) {
    throw new Error(`[embeddings] embedding dims mismatch (code=${codeLen}, doc=${docLen}).`);
  }
  const merged = new Float32Array(codeLen);
  for (let i = 0; i < merged.length; i += 1) {
    const codeVal = Number(code[i] ?? 0);
    const docVal = Number(doc[i] ?? 0);
    const safeCode = Number.isFinite(codeVal) ? codeVal : 0;
    const safeDoc = Number.isFinite(docVal) ? docVal : 0;
    merged[i] = (safeCode + safeDoc) / 2;
  }
  return merged;
};

/**
 * Normalize a vector in place using L2 norm.
 * @param {Float32Array} vec
 * @returns {Float32Array}
 */
export const normalizeEmbeddingVectorInPlace = (vec) => {
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return vec;
  for (let i = 0; i < vec.length; i += 1) {
    vec[i] = vec[i] / norm;
  }
  return vec;
};

/**
 * Normalize a vector into a new Float32Array.
 * @param {ArrayLike<number>} vec
 * @returns {Float32Array}
 */
export const normalizeEmbeddingVector = (vec) => {
  const length = vec && typeof vec.length === 'number' ? vec.length : 0;
  if (!length) return new Float32Array(0);
  const out = vec instanceof Float32Array ? new Float32Array(vec) : Float32Array.from(vec);
  return normalizeEmbeddingVectorInPlace(out);
};
