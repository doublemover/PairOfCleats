import { quantizeVec } from '../../embedding.js';
import { DEFAULT_STUB_DIMS } from '../../../shared/embedding.js';
import { isVectorLike } from '../../../shared/embedding-utils.js';
import { maybeYield } from './constants.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { assertQuantizedEmbeddingRow, resolveEmbeddingQuantizationSpec } from '../../../shared/embedding-quantization-spec.js';

/** Preserve each channel's absence independently of fixed-width disk padding. */
export const buildDenseVectors = async ({
  chunks, embeddingsEnabled = true, useStubEmbeddings, modelId, log,
  workerPool, quantizePool, requestYield, buildStage = null, quantization = {}, abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  const spec = resolveEmbeddingQuantizationSpec(quantization);
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
    if (vector.length !== dims) throw new Error('[postings] embedding dimensions differ across dense rows.');
    if (isByteVector(vector)) assertQuantizedEmbeddingRow(vector, { spec, dims, allowEmpty: false });
    else for (const value of vector) if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('[postings] embedding values must be finite numbers.');
    }
    return vector;
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
      throwIfAborted(abortSignal);
      const batch = pending.slice(offset, offset + batchSize);
      let quantized = null;
      if (worker) {
        try {
          const candidate = await worker.runQuantize({ vectors: batch.map(row => row.vector),
            quantization: spec, minVal: spec.minVal, maxVal: spec.maxVal, levels: spec.levels }, { signal: abortSignal });
          throwIfAborted(abortSignal);
          if (!Array.isArray(candidate) || candidate.length !== batch.length) throw new Error('Invalid worker quantization rows.');
          for (let index = 0; index < candidate.length; index++) {
            assertQuantizedEmbeddingRow(candidate[index], { spec, dims: batch[index].vector.length, allowEmpty: false });
          }
          quantized = candidate;
        } catch (error) {
          throwIfAborted(abortSignal);
          if (isAbortError(error) || ['ERR_PROCESS_TASK_BUDGET', 'ERR_TOKENIZER_RESOURCE_PRESSURE',
            'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', 'ERR_WORKER_POOL_CLEANUP_TIMEOUT'].includes(error?.code)
            || error?.cleanupError || error instanceof AggregateError) throw error;
          if (!warnedWorker) { warnedWorker = true; log?.('Quantize worker unavailable; falling back to inline quantization.'); }
        }
      }
      if (quantized === null) quantized = batch.map(row => quantizeVec(row.vector, spec.minVal, spec.maxVal, spec.levels));
      batch.forEach((row, index) => { output[row.index] = quantized[index]; });
      await maybeYield(requestYield);
    }
    return output;
  };
  return { dims, quantizedVectors: await quantize(merged), quantizedDocVectors: await quantize(doc), quantizedCodeVectors: await quantize(code) };
};
