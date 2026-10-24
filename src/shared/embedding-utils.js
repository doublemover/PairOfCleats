export {
  countNonEmptyVectors,
  isNonEmptyVector,
  isVectorLike,
  mergeEmbeddingVectors,
  normalizeEmbeddingVector,
  normalizeEmbeddingVectorInPlace
} from './embedding-vector-utils.js';
export {
  clampQuantizedVectorInPlace,
  clampQuantizedVectorsInPlace,
  quantizeEmbeddingVector,
  quantizeEmbeddingVectorUint8
} from './embedding-quantization.js';

/** Default pooling strategy for embeddings. */
export const DEFAULT_EMBEDDING_POOLING = 'mean';
/** Default L2 normalization toggle for embeddings. */
export const DEFAULT_EMBEDDING_NORMALIZE = true;
/** Default truncation toggle for embeddings. */
export const DEFAULT_EMBEDDING_TRUNCATION = true;

/**
 * Normalize embedding model output to a list of vectors.
 * Supports array outputs and tensor-like { data, dims } payloads.
 *
 * @param {unknown} output
 * @param {number} count
 * @returns {Float32Array[]}
 */
export { admitEmbeddingBatchOutput as normalizeEmbeddingBatchOutput } from './embedding-output-admission.js';
