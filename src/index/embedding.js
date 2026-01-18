import { getEmbeddingAdapter } from '../shared/embedding-adapter.js';
import { normalizeEmbeddingVector } from '../shared/embedding-utils.js';

/**
 * Quantize a float vector into uint8 bins for compact storage.
 * @param {number[]} vec
 * @param {number} [minVal]
 * @param {number} [maxVal]
 * @param {number} [levels]
 * @returns {number[]}
 */
export function quantizeVec(vec, minVal = -1, maxVal = 1, levels = 256) {
  if (!vec || typeof vec.length !== 'number') return [];
  const length = Math.max(0, Math.floor(vec.length));
  if (!length) return [];
  const out = new Array(length);
  const range = maxVal - minVal;
  if (!Number.isFinite(range) || range === 0) {
    return out.fill(0);
  }
  const scale = (levels - 1) / range;
  const maxQ = levels - 1;
  for (let i = 0; i < length; i += 1) {
    const f = Number(vec[i]);
    const q = Math.round(((f - minVal) * scale));
    out[i] = Math.max(0, Math.min(maxQ, q));
  }
  return out;
}


/**
 * Quantize a float vector into a Uint8Array for compact storage.
 *
 * This is intentionally separate from `quantizeVec()` so callers can avoid
 * retaining large JS number arrays in the V8 heap.
 *
 * @param {ArrayLike<number>} vec
 * @param {number} [minVal]
 * @param {number} [maxVal]
 * @param {number} [levels]
 * @returns {Uint8Array}
 */
export function quantizeVecUint8(vec, minVal = -1, maxVal = 1, levels = 256) {
  if (!vec || typeof vec !== 'object') return new Uint8Array(0);
  const length = Number.isFinite(vec.length) ? Math.max(0, Math.floor(vec.length)) : 0;
  if (!length) return new Uint8Array(0);

  const lvlRaw = Number(levels);
  const lvl = Number.isFinite(lvlRaw) ? Math.max(2, Math.min(256, Math.floor(lvlRaw))) : 256;
  const min = Number(minVal);
  const max = Number(maxVal);
  const range = max - min;

  const out = new Uint8Array(length);
  if (!Number.isFinite(range) || range === 0) return out;

  const scale = (lvl - 1) / range;
  const maxQ = lvl - 1;

  for (let i = 0; i < length; i += 1) {
    const f = vec[i];
    const q = Math.round((Number(f) - min) * scale);
    if (q <= 0) out[i] = 0;
    else if (q >= maxQ) out[i] = maxQ;
    else out[i] = q;
  }

  return out;
}

/**
 * L2-normalize an embedding vector.
 * @param {number[]} vec
 * @returns {number[]}
 */
export const normalizeVec = normalizeEmbeddingVector;

/**
 * Build an embedder wrapper for chunk embeddings.
 * @param {object} options
 * @param {boolean} options.useStubEmbeddings
 * @param {string} options.modelId
 * @param {number} options.dims
 * @param {string} options.modelsDir
 * @returns {{getChunkEmbedding:(text:string)=>Promise<number[]>,getChunkEmbeddings:(texts:string[])=>Promise<number[][]>,embedderPromise:Promise<any>|null}}
 */
export function createEmbedder({
  rootDir,
  useStubEmbeddings,
  modelId,
  dims,
  modelsDir,
  provider,
  onnx
}) {
  const adapter = getEmbeddingAdapter({
    rootDir,
    useStub: useStubEmbeddings,
    modelId,
    dims,
    modelsDir,
    provider,
    onnxConfig: onnx
  });

  async function getChunkEmbedding(text) {
    return adapter.embedOne(text);
  }

  async function getChunkEmbeddings(texts) {
    return adapter.embed(texts);
  }

  return { getChunkEmbedding, getChunkEmbeddings, embedderPromise: adapter.embedderPromise };
}
