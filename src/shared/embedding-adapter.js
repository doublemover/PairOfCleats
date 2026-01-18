import { resolveStubDims, stubEmbedding } from './embedding.js';
import { createOnnxEmbedder, normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import {
  DEFAULT_EMBEDDING_POOLING,
  DEFAULT_EMBEDDING_NORMALIZE,
  normalizeEmbeddingBatchOutput
} from './embedding-utils.js';

let transformersModulePromise = null;
const pipelineCache = new Map();
const adapterCache = new Map();
const pipelineOptions = Object.freeze({
  pooling: DEFAULT_EMBEDDING_POOLING,
  normalize: DEFAULT_EMBEDDING_NORMALIZE
});

const isDlopenFailure = (err) => {
  const code = err?.code || err?.cause?.code;
  if (code === 'ERR_DLOPEN_FAILED') return true;
  const message = err?.message || '';
  return message.includes('ERR_DLOPEN_FAILED');
};

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

const createXenovaAdapter = ({ modelId, modelsDir }) => {
  const embedderPromise = loadPipeline(modelId, modelsDir);
  const embed = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const embedder = await embedderPromise;
    const output = await embedder(list, pipelineOptions);
    return normalizeEmbeddingBatchOutput(output, list.length);
  };
  const embedOne = async (text) => {
    const list = await embed([text]);
    return list[0] || new Float32Array(0);
  };
  return { embed, embedOne, embedderPromise, provider: 'xenova' };
};

const createAdapter = ({
  rootDir,
  useStub,
  modelId,
  dims,
  modelsDir,
  provider,
  onnxConfig
}) => {
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  if (useStub) {
    const safeDims = resolveStubDims(dims);
    const embed = async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      if (!list.length) return [];
      return list.map((text) => stubEmbedding(text, safeDims));
    };
    const embedOne = async (text) => stubEmbedding(text, safeDims);
    return { embed, embedOne, embedderPromise: null, provider: resolvedProvider };
  }

  if (resolvedProvider === 'onnx') {
    const onnxEmbedder = createOnnxEmbedder({
      rootDir,
      modelId,
      modelsDir,
      onnxConfig
    });
    let fallbackAdapter = null;
    let warned = false;
    const ensureFallback = () => {
      if (!fallbackAdapter) {
        fallbackAdapter = createXenovaAdapter({ modelId, modelsDir });
      }
      return fallbackAdapter;
    };
    const warnFallback = (err) => {
      if (warned) return;
      warned = true;
      const code = err?.code || err?.cause?.code || 'ERR_DLOPEN_FAILED';
      console.warn(`[embeddings] onnxruntime-node failed to load (${code}); falling back to xenova.`);
    };
    return {
      embed: async (texts) => {
        try {
          return await onnxEmbedder.getEmbeddings(texts);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback().embed(texts);
          }
          throw err;
        }
      },
      embedOne: async (text) => {
        try {
          return await onnxEmbedder.getEmbedding(text);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback().embedOne(text);
          }
          throw err;
        }
      },
      embedderPromise: onnxEmbedder.embedderPromise,
      provider: resolvedProvider
    };
  }

  return createXenovaAdapter({ modelId, modelsDir });
};

export function getEmbeddingAdapter(options) {
  const resolvedProvider = normalizeEmbeddingProvider(options?.provider, { strict: true });
  const normalizedOnnxConfig = normalizeOnnxConfig(options?.onnxConfig);
  const cacheKey = JSON.stringify({
    provider: resolvedProvider,
    modelId: options?.modelId || null,
    modelsDir: options?.modelsDir || null,
    onnxConfig: normalizedOnnxConfig,
    rootDir: options?.rootDir || null,
    useStub: options?.useStub === true,
    dims: options?.dims ?? null
  });
  if (!adapterCache.has(cacheKey)) {
    adapterCache.set(cacheKey, createAdapter({
      rootDir: options?.rootDir,
      useStub: options?.useStub === true,
      modelId: options?.modelId,
      dims: options?.dims,
      modelsDir: options?.modelsDir,
      provider: resolvedProvider,
      onnxConfig: normalizedOnnxConfig
    }));
  }
  return adapterCache.get(cacheKey);
}
