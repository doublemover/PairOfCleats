import { resolveStubDims, stubEmbedding } from '../shared/embedding.js';
import { createOnnxEmbedder, normalizeEmbeddingProvider } from '../shared/onnx-embeddings.js';

// NOTE: @xenova/transformers is large and expensive to load.
// We intentionally lazy-load it so that stub embeddings (used heavily in tests)
// do not pay the memory/startup cost.
let transformersModulePromise = null;
const pipelineCache = new Map();

async function loadTransformersModule(modelsDir) {
  if (!transformersModulePromise) {
    transformersModulePromise = import('@xenova/transformers');
  }
  const mod = await transformersModulePromise;
  if (modelsDir && mod?.env) {
    mod.env.cacheDir = modelsDir;
  }
  return mod;
}

async function loadPipeline(modelId, modelsDir) {
  const cacheKey = `${modelId || ''}:${modelsDir || ''}`;
  if (!pipelineCache.has(cacheKey)) {
    const promise = loadTransformersModule(modelsDir)
      .then(({ pipeline }) => pipeline('feature-extraction', modelId));
    pipelineCache.set(cacheKey, promise);
  }
  return pipelineCache.get(cacheKey);
}

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
export function normalizeVec(vec) {
  const length = vec && typeof vec.length === 'number' ? vec.length : 0;
  if (!length) return new Float32Array(0);
  const out = Float32Array.from(vec);
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) {
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return out;
  for (let i = 0; i < out.length; i += 1) {
    out[i] = out[i] / norm;
  }
  return out;
}

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
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  const onnxEmbedder = !useStubEmbeddings && resolvedProvider === 'onnx'
    ? createOnnxEmbedder({
      rootDir,
      modelId,
      modelsDir,
      onnxConfig: onnx
    })
    : null;
  const embedderPromise = useStubEmbeddings
    ? null
    : (onnxEmbedder
      ? onnxEmbedder.embedderPromise
      : loadPipeline(modelId, modelsDir));

  const normalizeBatchOutput = (output, count) => {
    if (!output) return Array.from({ length: count }, () => new Float32Array(0));
    if (Array.isArray(output)) {
      return output.map((entry) => {
        if (!entry) return new Float32Array(0);
        const data = entry.data || entry;
        return data instanceof Float32Array ? data : Float32Array.from(data);
      });
    }
    if (output.data && Array.isArray(output.dims) && output.dims.length === 2) {
      const rows = output.dims[0];
      const cols = output.dims[1];
      const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
      const out = [];
      for (let i = 0; i < rows; i += 1) {
        out.push(data.slice(i * cols, (i + 1) * cols));
      }
      while (out.length < count) out.push(new Float32Array(0));
      return out;
    }
    if (output.data) {
      return [output.data instanceof Float32Array ? output.data : Float32Array.from(output.data)];
    }
    return Array.from({ length: count }, () => new Float32Array(0));
  };

  async function getChunkEmbedding(text) {
    if (useStubEmbeddings) {
      const safeDims = resolveStubDims(dims);
      return stubEmbedding(text, safeDims);
    }
    if (resolvedProvider === 'onnx') {
      return onnxEmbedder.getEmbedding(text);
    }
    const embedder = await embedderPromise;
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
  }

  async function getChunkEmbeddings(texts) {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    if (useStubEmbeddings) {
      const safeDims = resolveStubDims(dims);
      return list.map((text) => stubEmbedding(text, safeDims));
    }
    if (resolvedProvider === 'onnx') {
      return onnxEmbedder.getEmbeddings(list);
    }
    const embedder = await embedderPromise;
    const output = await embedder(list, { pooling: 'mean', normalize: true });
    return normalizeBatchOutput(output, list.length);
  }

  return { getChunkEmbedding, getChunkEmbeddings, embedderPromise };
}
