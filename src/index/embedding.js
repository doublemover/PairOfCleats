import { getEmbeddingAdapter } from '../shared/embedding-adapter.js';
import {
  formatEmbeddingInput,
  formatEmbeddingInputs,
  resolveEmbeddingInputFormatting
} from '../shared/embedding-input-format.js';
import {
  isNonEmptyVector,
  normalizeEmbeddingVector,
  quantizeEmbeddingVector,
  quantizeEmbeddingVectorUint8
} from '../shared/embedding-utils.js';

export const quantizeVec = quantizeEmbeddingVector;

export const quantizeVecUint8 = quantizeEmbeddingVectorUint8;

const resolveModelAwareCharsPerToken = (modelId) => {
  const id = String(modelId || '').toLowerCase();
  if (!id) return 4;
  if (id.includes('jina-embeddings-v2-base-code') || id.includes('code')) return 3;
  if (id.includes('e5')) return 4;
  if (id.includes('bge')) return 4;
  return 4;
};

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
 * @returns {{
 *   getChunkEmbedding:(text:string)=>Promise<number[]>,
 *   getChunkEmbeddings:(texts:string[])=>Promise<number[][]>,
 *   embedderPromise:Promise<any>|null,
 *   getActiveProvider:()=>string,
 *   executionInfo:()=>object
 * }}
 */
export function createEmbedder({
  rootDir,
  useStubEmbeddings,
  modelId,
  dims,
  modelsDir,
  provider,
  onnx,
  normalize,
  modelProfile,
  modelArtifact = null
}) {
  const adapter = getEmbeddingAdapter({
    rootDir,
    useStub: useStubEmbeddings,
    modelId,
    dims,
    modelsDir,
    provider,
    onnxConfig: onnx,
    normalize,
    modelProfile,
    modelArtifact
  });
  const inputFormatting = resolveEmbeddingInputFormatting(modelId);
  const modelAwareCharsPerToken = resolveModelAwareCharsPerToken(modelId);
  let observedDims = null;
  let inferenceSucceeded = false;
  const observeVectors = (vectors) => {
    if (Array.isArray(vectors) && vectors.length && vectors.every(isNonEmptyVector)) {
      const width = vectors[0].length;
      if (vectors.every((vector) => vector.length === width)) {
        observedDims = width;
        inferenceSucceeded = true;
      }
    }
    return vectors;
  };

  async function getChunkEmbedding(text) {
    const payload = formatEmbeddingInput(text, {
      modelId,
      kind: 'passage',
      formatting: inputFormatting
    });
    const vector = await adapter.embedOne(payload);
    observeVectors([vector]);
    return vector;
  }

  async function getChunkEmbeddings(texts) {
    const payloads = formatEmbeddingInputs(texts, {
      modelId,
      kind: 'passage',
      formatting: inputFormatting
    });
    return observeVectors(await adapter.embed(payloads));
  }

  const estimateChunkTokensBatch = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const payloads = formatEmbeddingInputs(list, {
      modelId,
      kind: 'passage',
      formatting: inputFormatting
    });
    const fallback = payloads.map((value) => {
      const chars = typeof value === 'string' ? value.length : 0;
      return Math.max(1, Math.ceil(chars / modelAwareCharsPerToken));
    });
    if (typeof adapter?.estimateTokensBatch !== 'function') {
      return fallback;
    }
    try {
      const estimated = await adapter.estimateTokensBatch(payloads);
      if (!Array.isArray(estimated) || estimated.length !== payloads.length) {
        estimated?.release?.();
        return fallback;
      }
      const out = new Array(estimated.length);
      for (let i = 0; i < estimated.length; i += 1) {
        out[i] = Math.max(1, Math.floor(Number(estimated[i]) || fallback[i] || 1));
      }
      if (typeof estimated.release === 'function') Object.defineProperty(out, 'release', { value: estimated.release });
      return out;
    } catch {
      return fallback;
    }
  };
  // Surface adapter concurrency capability so embedding pipelines can safely
  // decide whether code/doc batches may run in parallel.
  getChunkEmbeddings.supportsParallelDispatch = adapter?.supportsParallelDispatch === true;
  // Estimate token pressure for formatted payloads so batching can size requests
  // by model-aware token counts instead of only char heuristics.
  getChunkEmbeddings.estimateTokensBatch = estimateChunkTokensBatch;
  const getActiveProvider = () => {
    const provider = adapter?.provider;
    return typeof provider === 'string' && provider.trim()
      ? provider
      : 'xenova';
  };
  // Telemetry must not access the adapter's loading getter. Vector evidence is
  // local to this wrapper; a cached adapter may have served an earlier attempt.
  const executionInfo = () => ({
    provider: getActiveProvider(),
    loaded: null,
    loading: null,
    device: null,
    executionProviders: null,
    effectiveNativeThreads: null,
    ...(adapter?.executionInfo?.() ?? {}),
    observedDims,
    inferenceSucceeded
  });

  return {
    getChunkEmbedding,
    getChunkEmbeddings,
    get embedderPromise() {
      return adapter.embedderPromise;
    },
    getActiveProvider,
    executionInfo,
    dispose: () => adapter.dispose?.()
  };
}
