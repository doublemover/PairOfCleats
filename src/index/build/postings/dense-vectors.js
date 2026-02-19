import { quantizeVec } from '../../embedding.js';
import { DEFAULT_STUB_DIMS } from '../../../shared/embedding.js';
import { isVectorLike } from '../../../shared/embedding-utils.js';

/**
 * @typedef {object} BuildDenseVectorsInput
 * @property {object[]} chunks
 * @property {boolean} [embeddingsEnabled=true]
 * @property {boolean} [useStubEmbeddings]
 * @property {string} [modelId]
 * @property {(message: string) => void} [log]
 * @property {object} [workerPool]
 * @property {object} [quantizePool]
 * @property {() => Promise<void> | null} [requestYield]
 * @property {string|null} [buildStage]
 */

/**
 * @typedef {object} BuildDenseVectorsOutput
 * @property {number} dims
 * @property {Array<Uint8Array|number[]>} quantizedVectors
 * @property {Array<Uint8Array|number[]>} quantizedDocVectors
 * @property {Array<Uint8Array|number[]>} quantizedCodeVectors
 */

/**
 * Build quantized dense vectors for merged, doc-only, and code-only channels.
 *
 * Behavior:
 * - Uses pre-quantized byte vectors when available.
 * - Otherwise quantizes float vectors via worker pool batches with inline fallback.
 * - Preserves deterministic dimensionality by truncating/padding to resolved `dims`.
 *
 * @param {BuildDenseVectorsInput} input
 * @returns {Promise<BuildDenseVectorsOutput>}
 */
export const buildDenseVectors = async ({
  chunks,
  embeddingsEnabled = true,
  useStubEmbeddings,
  modelId,
  log,
  workerPool,
  quantizePool,
  requestYield,
  buildStage = null
}) => {
  if (!embeddingsEnabled) {
    const stageLabel = buildStage ? ` (${buildStage})` : '';
    if (typeof log === 'function') {
      log(`Embeddings disabled${stageLabel}; skipping dense vector build.`);
    }
    return {
      dims: 0,
      quantizedVectors: [],
      quantizedDocVectors: [],
      quantizedCodeVectors: []
    };
  }

  const embedLabel = useStubEmbeddings ? 'stub' : 'model';
  if (typeof log === 'function') {
    log(`Using ${embedLabel} embeddings for dense vectors (${modelId})...`);
  }

  /**
   * Detect quantized vectors represented as byte typed arrays.
   *
   * @param {unknown} value
   * @returns {boolean}
   */
  const isByteVector = (value) => (
    value
    && typeof value === 'object'
    && typeof value.length === 'number'
    && ArrayBuffer.isView(value)
    && !(value instanceof DataView)
    && value.BYTES_PER_ELEMENT === 1
    && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
  );

  /**
   * Resolve canonical dimension count from highest-confidence signal.
   *
   * @returns {number}
   */
  const resolveDims = () => {
    for (const chunk of chunks) {
      const vec = chunk?.embedding_u8;
      if (isByteVector(vec) && vec.length) return vec.length;
    }
    for (const chunk of chunks) {
      const vec = chunk?.embedding;
      if (isVectorLike(vec) && vec.length) return vec.length;
      const code = chunk?.embed_code;
      if (isVectorLike(code) && code.length) return code.length;
      const doc = chunk?.embed_doc;
      if (isVectorLike(doc) && doc.length) return doc.length;
    }
    return DEFAULT_STUB_DIMS;
  };

  const dims = resolveDims();
  const ZERO_QUANT = 128;
  const zeroU8 = new Uint8Array(dims);
  zeroU8.fill(ZERO_QUANT);
  const zeroVec = new Array(dims).fill(0);

  /**
   * Normalize a float vector to `dims` while preserving order.
   *
   * @param {unknown} vec
   * @returns {number[]|Float32Array}
   */
  const normalizeFloatVector = (vec) => {
    if (!isVectorLike(vec)) return zeroVec;
    if (vec.length === dims) return ArrayBuffer.isView(vec) ? Array.from(vec) : vec;
    if (vec.length > dims) return Array.from(vec).slice(0, dims);
    const out = Array.from(vec);
    while (out.length < dims) out.push(0);
    return out;
  };

  /**
   * Normalize a byte vector to `dims`, optionally treating empty vectors as zero.
   *
   * @param {unknown} vec
   * @param {{ emptyIsZero?: boolean }} [options]
   * @returns {Uint8Array|null}
   */
  const normalizeByteVector = (vec, { emptyIsZero = false } = {}) => {
    if (!isByteVector(vec)) return null;
    if (!vec.length && emptyIsZero) return zeroU8;
    if (vec.length === dims) return vec;
    const out = new Uint8Array(dims);
    if (vec.length >= dims) {
      out.set(vec.subarray(0, dims));
    } else {
      out.set(vec);
      out.fill(ZERO_QUANT, vec.length);
    }
    return out;
  };

  const hasPreQuantized = chunks.some((chunk) => {
    const v = chunk?.embedding_u8;
    return isByteVector(v) && v.length;
  });

  let docMarkerWarned = false;
  const warnMissingDocMarker = () => {
    if (docMarkerWarned) return;
    docMarkerWarned = true;
    if (typeof log === 'function') {
      log('Missing doc embedding marker for some chunks; falling back to merged embeddings.');
    }
  };

  let quantizedVectors = [];
  let quantizedDocVectors = [];
  let quantizedCodeVectors = [];

  if (hasPreQuantized) {
    quantizedVectors = new Array(chunks.length);
    quantizedDocVectors = new Array(chunks.length);
    quantizedCodeVectors = new Array(chunks.length);

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const merged = chunk?.embedding_u8;
      const mergedVec = normalizeByteVector(merged, { emptyIsZero: true }) || zeroU8;

      const doc = chunk?.embed_doc_u8;
      let docVec;
      if (doc == null) {
        warnMissingDocMarker();
        docVec = mergedVec;
      } else {
        docVec = normalizeByteVector(doc, { emptyIsZero: true });
        if (!docVec) {
          throw new Error('[postings] invalid doc embedding marker for chunk.');
        }
      }

      const code = chunk?.embed_code_u8;
      let codeVec = normalizeByteVector(code);
      if (!codeVec) codeVec = mergedVec;

      quantizedVectors[i] = mergedVec;
      quantizedDocVectors[i] = docVec;
      quantizedCodeVectors[i] = codeVec;
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
    }
  } else {
    const selectEmbedding = (chunk) => (
      isVectorLike(chunk?.embedding) && chunk.embedding.length
        ? normalizeFloatVector(chunk.embedding)
        : zeroVec
    );
    const selectDocEmbedding = (chunk) => {
      if (Object.prototype.hasOwnProperty.call(chunk || {}, 'embed_doc')) {
        if (!isVectorLike(chunk.embed_doc)) {
          throw new Error('[postings] invalid doc embedding marker for chunk.');
        }
        return chunk.embed_doc.length ? normalizeFloatVector(chunk.embed_doc) : zeroVec;
      }
      warnMissingDocMarker();
      if (isVectorLike(chunk?.embedding) && chunk.embedding.length) {
        return normalizeFloatVector(chunk.embedding);
      }
      return zeroVec;
    };
    const selectCodeEmbedding = (chunk) => {
      if (isVectorLike(chunk?.embed_code) && chunk.embed_code.length) {
        return normalizeFloatVector(chunk.embed_code);
      }
      if (isVectorLike(chunk?.embedding) && chunk.embedding.length) {
        return normalizeFloatVector(chunk.embedding);
      }
      return zeroVec;
    };
    const quantizeWorker = quantizePool || workerPool;
    let quantizeWarned = false;
    const warnQuantizeFallback = () => {
      if (quantizeWarned) return;
      if (typeof log === 'function') {
        log('Quantize worker unavailable; falling back to inline quantization.');
      }
      quantizeWarned = true;
    };
    /**
     * Quantize vectors selected from chunks, using worker pool batching when
     * available and falling back to inline quantization on worker failures.
     *
     * @param {(chunk: object) => number[]|Float32Array|Uint8Array} selector
     * @returns {Promise<Array<Uint8Array|number[]>>}
     */
    const quantizeVectors = async (selector) => {
      const out = new Array(chunks.length);
      if (!quantizeWorker) {
        for (let i = 0; i < chunks.length; i += 1) {
          out[i] = quantizeVec(selector(chunks[i]));
          const waitForYield = requestYield?.();
          if (waitForYield) await waitForYield;
        }
        return out;
      }
      const batchSize = quantizeWorker.config?.quantizeBatchSize || 128;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const end = Math.min(i + batchSize, chunks.length);
        const batch = [];
        for (let j = i; j < end; j += 1) {
          const vec = selector(chunks[j]);
          if (ArrayBuffer.isView(vec) && !(vec instanceof DataView)) {
            batch.push(vec);
          } else {
            batch.push(Float32Array.from(vec));
          }
        }
        try {
          const chunk = await quantizeWorker.runQuantize({ vectors: batch });
          if (Array.isArray(chunk) && chunk.length === batch.length) {
            for (let j = 0; j < chunk.length; j += 1) {
              out[i + j] = chunk[j];
            }
          } else {
            warnQuantizeFallback();
            for (let j = 0; j < batch.length; j += 1) {
              out[i + j] = quantizeVec(batch[j]);
            }
          }
        } catch {
          warnQuantizeFallback();
          for (let j = 0; j < batch.length; j += 1) {
            out[i + j] = quantizeVec(batch[j]);
          }
        }
      }
      return out;
    };
    quantizedVectors = await quantizeVectors(selectEmbedding);
    quantizedDocVectors = await quantizeVectors(selectDocEmbedding);
    quantizedCodeVectors = await quantizeVectors(selectCodeEmbedding);
  }

  return {
    dims,
    quantizedVectors,
    quantizedDocVectors,
    quantizedCodeVectors
  };
};
