import { resolveStubDims, stubEmbedding } from './embedding.js';
import { createOnnxEmbedder, normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import {
  DEFAULT_EMBEDDING_POOLING,
  normalizeEmbeddingBatchOutput
} from './embedding-utils.js';

let transformersModulePromise = null;
const pipelineCache = new Map();
const adapterCache = new Map();
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

const createXenovaAdapter = ({ modelId, modelsDir, normalize }) => {
  let embedderPromise = null;
  const ensureEmbedder = () => {
    if (!embedderPromise) {
      embedderPromise = loadPipeline(modelId, modelsDir);
    }
    return embedderPromise;
  };
  const pipelineOptions = {
    pooling: DEFAULT_EMBEDDING_POOLING,
    normalize: normalize !== false
  };
  const embed = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const embedder = await ensureEmbedder();
    const output = await embedder(list, pipelineOptions);
    return normalizeEmbeddingBatchOutput(output, list.length);
  };
  const embedOne = async (text) => {
    const list = await embed([text]);
    return list[0] || new Float32Array(0);
  };
  return {
    embed,
    embedOne,
    get embedderPromise() {
      return ensureEmbedder();
    },
    provider: 'xenova'
  };
};

const createAdapter = ({
  rootDir,
  useStub,
  modelId,
  dims,
  modelsDir,
  provider,
  onnxConfig,
  normalize
}) => {
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  if (useStub) {
    const safeDims = resolveStubDims(dims);
    const embed = async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      if (!list.length) return [];
      return list.map((text) => stubEmbedding(text, safeDims, normalize !== false));
    };
    const embedOne = async (text) => stubEmbedding(text, safeDims, normalize !== false);
    return { embed, embedOne, embedderPromise: null, provider: resolvedProvider };
  }

  if (resolvedProvider === 'onnx') {
    const onnxEmbedder = createOnnxEmbedder({
      rootDir,
      modelId,
      modelsDir,
      onnxConfig,
      normalize
    });
    let fallbackAdapter = null;
    let warned = false;
    const ensureFallback = () => {
      if (!fallbackAdapter) {
        fallbackAdapter = createXenovaAdapter({ modelId, modelsDir, normalize });
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

  return createXenovaAdapter({ modelId, modelsDir, normalize });
};

export function getEmbeddingAdapter(options) {
  const resolvedProvider = normalizeEmbeddingProvider(options?.provider, { strict: true });
  const normalizedOnnxConfig = normalizeOnnxConfig(options?.onnxConfig);
  const normalize = options?.normalize !== false;
  const cacheKey = JSON.stringify({
    provider: resolvedProvider,
    modelId: options?.modelId || null,
    modelsDir: options?.modelsDir || null,
    onnxConfig: normalizedOnnxConfig,
    rootDir: options?.rootDir || null,
    useStub: options?.useStub === true,
    dims: options?.dims ?? null,
    normalize
  });
  if (!adapterCache.has(cacheKey)) {
    adapterCache.set(cacheKey, createAdapter({
      rootDir: options?.rootDir,
      useStub: options?.useStub === true,
      modelId: options?.modelId,
      dims: options?.dims,
      modelsDir: options?.modelsDir,
      provider: resolvedProvider,
      onnxConfig: normalizedOnnxConfig,
      normalize
    }));
  }
  return adapterCache.get(cacheKey);
}
