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

export const createXenovaAdapter = ({ modelId, modelsDir, normalize, loadPipeline, modelProfile, localFilesOnly = false, sessionOptions = {}, modelFileName = null }) => {
  let embedderPromise = null;
  let resolvedEmbedder = null;
  const ensureEmbedder = () => {
    if (!embedderPromise) {
      embedderPromise = loadPipeline(modelId, modelsDir, modelProfile, localFilesOnly, sessionOptions, modelFileName).then((embedder) => {
        resolvedEmbedder = embedder;
        return embedder;
      }).catch((err) => {
        embedderPromise = null;
        resolvedEmbedder = null;
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
    prepare: async (texts) => {
      const embedder = await ensureEmbedder();
      if (!embedder.prepare) throw new Error('Prepared token inputs require the EG2 adapter.');
      return embedder.prepare(texts);
    },
    embedPrepared: async (items) => {
      const embedder = await ensureEmbedder();
      if (!embedder.embedPrepared) throw new Error('Prepared token inputs require the EG2 adapter.');
      return embedder.embedPrepared(items);
    },
    executionInfo: () => ({
      provider: 'xenova', requestedProvider: 'xenova', stub: false,
      loaded: resolvedEmbedder !== null, loading: embedderPromise !== null && resolvedEmbedder === null,
      modelArtifact: null, effectiveSessionOptions: null,
      preparedInputs: !!modelProfile, device: null,
      executionProviders: null,
      modelFileName, requestedSessionOptions: structuredClone(sessionOptions),
      effectiveNativeThreads: null, effectiveGraphExecutionMode: null, sessions: [],
      maxLength: modelProfile?.maxLength ?? null, maxConcurrentInference: modelProfile ? 1 : null,
      profilingEnabled: sessionOptions.enableProfiling === true, profilingEnded: false,
      optimizedModelFilePath: sessionOptions.optimizedModelFilePath ?? null,
      ...(resolvedEmbedder?.executionInfo?.() ?? {})
    }),
    endProfiling: async () => {
      const embedder = await ensureEmbedder();
      return embedder.endProfiling?.() ?? { enabled: false, sessions: [] };
    },
    dispose: async () => {
      if (!embedderPromise) return;
      const embedder = await embedderPromise;
      await embedder.dispose?.();
    },
    estimateTokensBatch: async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      return list.map((text) => estimateTokensHeuristic(text));
    },
    get embedderPromise() {
      return ensureEmbedder();
    },
    provider: 'xenova',
    supportsParallelDispatch: !modelProfile
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
  modelProfile,
  localFilesOnly = false,
  sessionOptions = {},
  modelFileName = null,
  normalize,
  loadPipeline,
  normalizeEmbeddingProvider
}) => {
  const resolvedProvider = normalizeEmbeddingProvider(provider, { strict: true });
  if (useStub) {
    const safeDims = resolveStubDims(modelProfile?.dimensions ?? dims);
    const embed = async (texts) => {
      const list = Array.isArray(texts) ? texts : [];
      if (!list.length) return [];
      return list.map((text) => stubEmbedding(text, safeDims, normalize !== false));
    };
    const embedOne = async (text) => stubEmbedding(text, safeDims, normalize !== false);
    return {
      embed,
      embedOne,
      executionInfo: () => ({
        provider: resolvedProvider, requestedProvider: resolvedProvider, stub: true,
        loaded: false, loading: false, device: null, executionProviders: null,
        effectiveNativeThreads: null, effectiveGraphExecutionMode: null,
        modelArtifact: null, effectiveSessionOptions: null
      }),
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
    let fallbackReason = null;
    let loaded = false;
    let loading = !!onnxEmbedder.embedderPromise;
    // The ONNX owner acknowledges only session construction here. Requested
    // providers/threads are not proof of effective native execution settings.
    onnxEmbedder.embedderPromise?.then(() => {
      loaded = true;
      loading = false;
    }, () => {
      loaded = false;
      loading = false;
    });
    const ensureFallback = (err) => {
      if (!fallbackAdapter) {
        fallbackAdapter = createXenovaAdapter({ modelId, modelsDir, normalize, loadPipeline });
        fallbackReason = {
          from: resolvedProvider, to: 'xenova', reason: 'native-load-failed',
          code: err?.code || err?.cause?.code || 'ERR_DLOPEN_FAILED'
        };
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
        if (fallbackAdapter) return fallbackAdapter.embed(texts);
        try {
          return await onnxEmbedder.getEmbeddings(texts);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback(err).embed(texts);
          }
          throw err;
        }
      },
      embedOne: async (text) => {
        if (fallbackAdapter) return fallbackAdapter.embedOne(text);
        try {
          return await onnxEmbedder.getEmbedding(text);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback(err).embedOne(text);
          }
          throw err;
        }
      },
      estimateTokensBatch: async (texts) => {
        if (fallbackAdapter) return fallbackAdapter.estimateTokensBatch(texts);
        try {
          return await onnxEmbedder.estimateTokens(texts);
        } catch (err) {
          if (isDlopenFailure(err)) {
            warnFallback(err);
            return ensureFallback(err).estimateTokensBatch(texts);
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
            const fallback = ensureFallback(err);
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
      executionInfo: () => ({
        ...(fallbackAdapter?.executionInfo() ?? {
          provider: activeProvider, stub: false, loaded, loading,
          device: null, executionProviders: null,
          effectiveNativeThreads: null, effectiveGraphExecutionMode: null,
          modelArtifact: null, effectiveSessionOptions: null,
          requestedSessionOptions: Object.fromEntries([
            'executionProviders', 'intraOpNumThreads', 'interOpNumThreads', 'graphOptimizationLevel'
          ].filter((key) => onnxConfig?.[key] != null)
            .map((key) => [key, structuredClone(onnxConfig[key])]))
        }),
        requestedProvider: resolvedProvider,
        requestedOnnxConfig: structuredClone(onnxConfig ?? {}),
        fallback: fallbackReason ? { ...fallbackReason } : null
      }),
      embedderPromise: onnxEmbedder.embedderPromise,
      get provider() {
        return activeProvider;
      },
      supportsParallelDispatch: true
    };
  }

  return createXenovaAdapter({ modelId, modelsDir, normalize, loadPipeline, modelProfile, localFilesOnly, sessionOptions, modelFileName });
};
