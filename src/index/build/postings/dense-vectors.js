import { quantizeVec } from '../../embedding.js';
import { DEFAULT_STUB_DIMS } from '../../../shared/embedding.js';
import { isVectorLike } from '../../../shared/embedding-utils.js';
import { maybeYield } from './constants.js';

/** Preserve each channel's absence independently of fixed-width disk padding. */
export const buildDenseVectors = async ({
  chunks, embeddingsEnabled = true, useStubEmbeddings, modelId, log,
  workerPool, quantizePool, requestYield, buildStage = null
}) => {
  if (!embeddingsEnabled) {
    log?.('Embeddings disabled' + (buildStage ? ' (' + buildStage + ')' : '') + '; skipping dense vector build.');
    return { dims: 0, quantizedVectors: [], quantizedDocVectors: [], quantizedCodeVectors: [] };
  }
  log?.('Using ' + (useStubEmbeddings ? 'stub' : 'model') + ' embeddings for dense vectors (' + modelId + ')...');
  const isByteVector = value => ArrayBuffer.isView(value) && !(value instanceof DataView)
    && value.BYTES_PER_ELEMENT === 1 && !Buffer.isBuffer(value);
  let dims = 0;
  for (const chunk of chunks) {
    for (const field of ['embedding_u8', 'embed_code_u8', 'embed_doc_u8', 'embedding', 'embed_code', 'embed_doc']) {
      const vector = chunk?.[field];
      if (isVectorLike(vector) && vector.length) { dims = vector.length; break; }
    }
    if (dims) break;
  }
  dims ||= DEFAULT_STUB_DIMS;
  const normalize = vector => {
    if (!isVectorLike(vector) || !vector.length) return [];
    if (vector.length === dims) return vector;
    const result = isByteVector(vector) ? new Uint8Array(dims).fill(128) : new Float32Array(dims);
    result.set(ArrayBuffer.isView(vector) ? vector.subarray(0, dims) : vector.slice(0, dims));
    return result;
  };
  let warnedDoc = false;
  const select = (chunk, field, fallback) => {
    const byteField = field + '_u8';
    if (Object.hasOwn(chunk || {}, byteField)) {
      const vector = chunk[byteField];
      if (vector == null) return [];
      if (!isByteVector(vector)) throw new Error('[postings] invalid quantized embedding marker for ' + field + '.');
      return normalize(vector);
    }
    if (Object.hasOwn(chunk || {}, field)) {
      const vector = chunk[field];
      if (vector == null) return [];
      if (!isVectorLike(vector)) throw new Error('[postings] invalid embedding marker for ' + field + '.');
      return normalize(vector);
    }
    return fallback;
  };
  const merged = [], doc = [], code = [];
  for (const chunk of chunks) {
    const mergedVector = select(chunk, 'embedding', []);
    merged.push(mergedVector);
    if (!Object.hasOwn(chunk || {}, 'embed_doc') && !Object.hasOwn(chunk || {}, 'embed_doc_u8') && !warnedDoc) {
      warnedDoc = true;
      log?.('Missing legacy doc embedding marker; falling back to merged embeddings.');
    }
    doc.push(select(chunk, 'embed_doc', mergedVector));
    code.push(select(chunk, 'embed_code', mergedVector));
  }
  const worker = quantizePool || workerPool;
  let warnedWorker = false;
  const quantize = async selected => {
    const output = new Array(selected.length);
    const pending = [];
    for (let index = 0; index < selected.length; index++) {
      const vector = selected[index];
      if (!vector.length) output[index] = new Uint8Array(0);
      else if (isByteVector(vector)) output[index] = vector;
      else pending.push({ index, vector: Float32Array.from(vector) });
    }
    const batchSize = Math.max(1, Math.floor(Number(worker?.config?.quantizeBatchSize) || 128));
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize);
      let quantized;
      if (worker) {
        try {
          quantized = await worker.runQuantize({ vectors: batch.map(row => row.vector) });
          if (!Array.isArray(quantized) || quantized.length !== batch.length) throw new Error('Invalid worker quantization rows.');
        } catch {
          if (!warnedWorker) { warnedWorker = true; log?.('Quantize worker unavailable; falling back to inline quantization.'); }
        }
      }
      if (!quantized) quantized = batch.map(row => quantizeVec(row.vector));
      batch.forEach((row, index) => { output[row.index] = quantized[index]; });
      await maybeYield(requestYield);
    }
    return output;
  };
  return { dims, quantizedVectors: await quantize(merged), quantizedDocVectors: await quantize(doc), quantizedCodeVectors: await quantize(code) };
};
