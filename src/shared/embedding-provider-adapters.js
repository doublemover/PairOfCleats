import { resolveStubDims, stubEmbedding } from './embedding.js';
import { createOnnxEmbedder } from './onnx-embeddings.js';
import {
  DEFAULT_EMBEDDING_POOLING,
  normalizeEmbeddingBatchOutput
} from './embedding-utils.js';
import {
  estimateTokensHeuristic,
  isDlopenFailure,
  normalizeAdapterPrewarmTexts
} from './embedding-adapter-helpers.js';

export const createXenovaAdapter = ({ modelId, modelsDir, normalize, loadPipeline }) => {
  let embedderPromise = null;
  const ensureEmbedder = () => {
    if (!embedderPromise) {
      embedderPromise = loadPipeline(modelId, modelsDir).catch((err) => {
        embedderPromise = null;
        throw err;
      });
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
    estimateTokensBatch: async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      return list.map((text) => estimateTokensHeuristic(text));
    },
    get embedderPromise() {
      return ensureEmbedder();
    },
    provider: 'xenova',
    supportsParallelDispatch: true
  };
};

export const createEmbeddingProviderAdapter = ({
  rootDir,
  useStub,
  modelId,
  dims,
  modelsDir,
  provider,
  onnxConfig,
  normalize,
  loadPipeline,
  normalizeEmbeddingProvider
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
    return {
      embed,
      embedOne,
      estimateTokensBatch: async (texts) => {
        const list = Array.isArray(texts) ? texts : [];
        return list.map((text) => estimateTokensHeuristic(text));
      },
      embedderPromise: null,
      provider: resolvedProvider,
      supportsParallelDispatch: true
    };
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
    let activeProvider = resolvedProvider;
    let warned = false;
    const ensureFallback = () => {
      if (!fallbackAdapter) {
        fallbackAdapter = createXenovaAdapter({ modelId, modelsDir, normalize, loadPipeline });
      }
      activeProvider = 'xenova';
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
      estimateTokensBatch: async (texts) => {
        try {
          return await onnxEmbedder.estimateTokens(texts);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback().estimateTokensBatch(texts);
          }
          throw err;
        }
      },
      prewarm: async ({
        tokenizer = true,
        model = false,
        texts = null
      } = {}) => {
        try {
          await onnxEmbedder.prewarm({ tokenizer, model, texts });
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            const fallback = ensureFallback();
            const warmTexts = normalizeAdapterPrewarmTexts(texts);
            const shouldWarmModel = model === true;
            if (shouldWarmModel && warmTexts?.length) {
              await fallback.embed(warmTexts);
            } else {
              const preloadPromise = fallback?.embedderPromise;
              if (preloadPromise && typeof preloadPromise.then === 'function') {
                await preloadPromise;
              }
            }
            return;
          }
          throw err;
        }
      },
      embedderPromise: onnxEmbedder.embedderPromise,
      get provider() {
        return activeProvider;
      },
      supportsParallelDispatch: true
    };
  }

  return createXenovaAdapter({ modelId, modelsDir, normalize, loadPipeline });
};
