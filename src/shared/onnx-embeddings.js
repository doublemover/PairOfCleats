import { assertEmbeddingArtifactCompatibility, embeddingArtifactReusable } from './embedding-artifact-identity.js';
import { resolveEmbeddingArtifactIdentityAsync } from './embedding-artifact-lease.js';
import { createDeferredEmbeddingAdapter } from './embedding-deferred-adapter.js';
import path from 'node:path';
import {
  DEFAULT_EMBEDDING_TRUNCATION,
  normalizeEmbeddingVectorInPlace
} from './embedding-utils.js';
import {
  LARGE_MODEL_BYTES,
  ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES,
  normalizeEmbeddingProvider,
  normalizeOnnxConfig,
  resolveOnnxModelPath,
  resolvePrewarmList,
  statSize
} from './onnx-embeddings/config.js';
import { createRunQueue } from './onnx-embeddings/run-queue.js';
import { __tokenizeBatchWithCacheForTests, tokenizeBatchWithCache, prepareTokenRowsWithCache, createPreparedTokenRows } from './onnx-embeddings/tokenization.js';

export {
  normalizeEmbeddingProvider,
  normalizeOnnxConfig,
  resolveOnnxConfig,
  resolveOnnxModelPath
} from './onnx-embeddings/config.js';
export { createRunQueue } from './onnx-embeddings/run-queue.js';
export { __tokenizeBatchWithCacheForTests } from './onnx-embeddings/tokenization.js';

const ONNX_CACHE_TTL_MS = 15 * 60 * 1000;
const ONNX_CACHE_MAX_ENTRIES = 8;
const onnxCache = new Map();

const retireEntry = (key, entry) => {
  if (onnxCache.get(key) === entry) onnxCache.delete(key);
  entry.retired = true;
  if (entry.references || entry.releasing) return;
  entry.releasing = entry.queue.onIdle().then(async () => {
    const loaded = await entry.promise.catch(() => null);
    await loaded?.session?.release?.();
    await loaded?.tokenizer?.dispose?.();
  });
  // GC/cache retirement has no caller to receive disposal failure.
  entry.releasing.catch(() => {});
};
const releaseEntry = (entry) => {
  entry.references = Math.max(0, entry.references - 1);
  if (!entry.references) retireEntry(entry.key, entry);
  return entry.releasing || Promise.resolve();
};
const sessionOwners = new FinalizationRegistry((entry) => { void releaseEntry(entry); });
export const __resetOnnxSessionCacheForTests = () => {
  for (const [key, entry] of onnxCache) retireEntry(key, entry);
};

const touchCacheEntry = (entry, now = Date.now()) => {
  if (!entry || typeof entry !== 'object') return;
  entry.lastAccessAt = now;
  entry.expiresAt = now + ONNX_CACHE_TTL_MS;
};

const pruneOnnxCache = (now = Date.now()) => {
  for (const [key, entry] of onnxCache.entries()) {
    if (!entry || typeof entry !== 'object') {
      onnxCache.delete(key);
      continue;
    }
    if (entry.expiresAt && entry.expiresAt <= now) {
      retireEntry(key, entry);
    }
  }
  if (onnxCache.size <= ONNX_CACHE_MAX_ENTRIES) return;
  const overflow = onnxCache.size - ONNX_CACHE_MAX_ENTRIES;
  const oldest = Array.from(onnxCache.entries())
    .sort((a, b) => (a[1]?.lastAccessAt || 0) - (b[1]?.lastAccessAt || 0))
    .slice(0, overflow);
  for (const [key, entry] of oldest) retireEntry(key, entry);
};

const resolveProviderName = (provider) => {
  if (typeof provider === 'string') return provider;
  if (!provider || typeof provider !== 'object') return '';
  return typeof provider.name === 'string' ? provider.name : '';
};

const isCpuOnlyProviders = (providers) => {
  if (!providers || !providers.length) return true;
  return providers.every((provider) => resolveProviderName(provider) === 'cpu');
};

const normalizeExecutionProviders = (providers, { applyCpuArenaGuard = false } = {}) => {
  if (!providers) return providers;
  return providers.map((entry) => {
    if (typeof entry === 'string') {
      return applyCpuArenaGuard && entry === 'cpu' ? { name: 'cpu', useArena: false } : entry;
    }
    if (applyCpuArenaGuard && entry && entry.name === 'cpu' && entry.useArena === undefined) {
      return { ...entry, useArena: false };
    }
    return entry;
  });
};

const buildSessionOptions = (config, { lowMemory = false } = {}) => {
  const options = {};
  const cpuSafeMode = config.cpuExecutionProviderTuning !== false && isCpuOnlyProviders(config.executionProviders);
  const applyCpuSafeguards = lowMemory || cpuSafeMode;
  const providers = normalizeExecutionProviders(config.executionProviders, {
    applyCpuArenaGuard: applyCpuSafeguards
  });
  if (providers && providers.length) {
    options.executionProviders = providers;
  } else if (applyCpuSafeguards) {
    options.executionProviders = [{ name: 'cpu', useArena: false }];
  }
  if (config.intraOpNumThreads) {
    options.intraOpNumThreads = config.intraOpNumThreads;
  } else if (applyCpuSafeguards) {
    options.intraOpNumThreads = 1;
  }
  if (config.interOpNumThreads) {
    options.interOpNumThreads = config.interOpNumThreads;
  } else if (applyCpuSafeguards) {
    options.interOpNumThreads = 1;
  }
  if (config.graphOptimizationLevel) {
    options.graphOptimizationLevel = config.graphOptimizationLevel;
  } else if (applyCpuSafeguards) {
    options.graphOptimizationLevel = 'basic';
  }
  if (applyCpuSafeguards) {
    options.enableCpuMemArena = false;
    options.enableMemPattern = false;
    options.executionMode = 'sequential';
  }
  return Object.keys(options).length ? options : undefined;
};

export const __buildSessionOptionsForTests = (config, options = {}) => {
  const normalized = normalizeOnnxConfig(config || {});
  return buildSessionOptions(normalized, options);
};

const fillInt64Buffer = (rows, width, buffer) => {
  let offset = 0;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    for (let c = 0; c < width; c += 1) {
      buffer[offset] = BigInt(row[c] ?? 0);
      offset += 1;
    }
  }
};

const ensureInt64Scratch = (scratch, size) => {
  if (!scratch.data || scratch.data.length < size) {
    scratch.data = new BigInt64Array(size);
  }
  return scratch.data.subarray(0, size);
};

const toTensor = (TensorCtor, rows, scratch) => {
  const batch = rows.length;
  const width = rows[0]?.length || 0;
  if (!batch || !width) return null;
  const size = batch * width;
  const data = ensureInt64Scratch(scratch, size);
  fillInt64Buffer(rows, width, data);
  return new TensorCtor('int64', data, [batch, width]);
};

const buildFeeds = (session, encoded, TensorCtor, scratch) => {
  const inputNames = Array.isArray(session.inputNames) ? session.inputNames : [];
  const feeds = {};
  const inputs = {
    input_ids: encoded.input_ids,
    attention_mask: encoded.attention_mask,
    token_type_ids: encoded.token_type_ids
  };
  for (const name of inputNames) {
    const values = inputs[name];
    if (!values) continue;
    if (!scratch.has(name)) scratch.set(name, { data: null });
    const tensor = toTensor(TensorCtor, values, scratch.get(name));
    if (tensor) feeds[name] = tensor;
  }
  return feeds;
};

const findOutput = (outputs) => {
  if (!outputs) return null;
  const preferred = [
    'sentence_embedding',
    'embeddings',
    'pooler_output',
    'last_hidden_state',
    'output_0'
  ];
  for (const key of preferred) {
    if (outputs[key]) return outputs[key];
  }
  const fallbackKey = Object.keys(outputs)[0];
  return fallbackKey ? outputs[fallbackKey] : null;
};

const meanPool = (tensor, attentionMask, normalizeVec) => {
  const dims = tensor?.dims || [];
  if (dims.length !== 3) return [];
  const [batch, seq, hidden] = dims;
  const data = tensor.data || [];
  const flatMask = attentionMask
    ? attentionMask
    : Array.from({ length: batch }, () => new Array(seq).fill(1));
  const output = new Array(batch).fill(null);
  for (let b = 0; b < batch; b += 1) {
    const vec = new Float32Array(hidden);
    let count = 0;
    for (let t = 0; t < seq; t += 1) {
      const maskVal = Number(flatMask[b]?.[t] ?? 0);
      if (!maskVal) continue;
      count += 1;
      const offset = (b * seq + t) * hidden;
      for (let h = 0; h < hidden; h += 1) {
        vec[h] += data[offset + h];
      }
    }
    if (count > 0) {
      for (let h = 0; h < hidden; h += 1) {
        vec[h] = vec[h] / count;
      }
    }
    output[b] = normalizeVec(vec);
  }
  return output;
};

const rowsFromTensor = (tensor, normalizeVec) => {
  const dims = tensor?.dims || [];
  if (dims.length !== 2) return [];
  const [rows, cols] = dims;
  const data = tensor.data || [];
  const hasSubarray = data && typeof data.subarray === 'function';
  const out = new Array(rows);
  for (let r = 0; r < rows; r += 1) {
    const start = r * cols;
    const vec = new Float32Array(cols);
    if (hasSubarray) {
      vec.set(data.subarray(start, start + cols));
    } else {
      for (let c = 0; c < cols; c += 1) {
        vec[c] = data[start + c] ?? 0;
      }
    }
    out[r] = normalizeVec(vec);
  }
  return out;
};

export function createOnnxEmbedder({ rootDir, modelId, modelsDir, onnxConfig, normalize, modelArtifact = null }) {
  const normalizeVec = normalize === false ? (vec) => vec : normalizeEmbeddingVectorInPlace;
  const normalized = normalizeOnnxConfig(onnxConfig);
  const resolvedModelPath = resolveOnnxModelPath({
    rootDir,
    modelPath: normalized.modelPath,
    modelsDir,
    modelId
  });
  if (!resolvedModelPath) {
    const basePath = normalized.modelPath || (modelsDir ? path.join(modelsDir, modelId || '') : '');
    throw new Error(
      `ONNX model path not found. Set indexing.embeddings.onnx.modelPath or run tools/download/models.js (expected near ${basePath || 'models dir'}).`
    );
  }
  if (!modelArtifact) return createDeferredEmbeddingAdapter({ provider: 'onnx', methods: ['getEmbedding', 'getEmbeddings', 'estimateTokens', 'prewarm'],
    acquire: async () => createOnnxEmbedder({ rootDir, modelId, modelsDir, onnxConfig, normalize,
      modelArtifact: await resolveEmbeddingArtifactIdentityAsync({ provider: 'onnx', modelId, modelsDir, rootDir, onnx: normalized }) }) });
  const selectedArtifact = modelArtifact;
  const modelSize = statSize(resolvedModelPath);
  const lowMemory = Number.isFinite(modelSize) && modelSize >= LARGE_MODEL_BYTES;
  const tokenizerId = normalized.tokenizerId || modelId;
  const cacheKey = JSON.stringify({
    resolvedModelPath,
    // Unknown tokenizer/model provenance is attempt-scoped even when weights exist.
    modelArtifact: selectedArtifact,
    tokenizerId,
    executionProviders: normalized.executionProviders || null,
    lowMemory,
    cpuExecutionProviderTuning: normalized.cpuExecutionProviderTuning !== false,
    intraOpNumThreads: normalized.intraOpNumThreads || null,
    interOpNumThreads: normalized.interOpNumThreads || null,
    graphOptimizationLevel: normalized.graphOptimizationLevel || null
  });
  const now = Date.now();
  pruneOnnxCache(now);
  let sessionEntry = onnxCache.get(cacheKey);
  if (sessionEntry) {
    touchCacheEntry(sessionEntry, now);
  } else {
    const sessionOptions = buildSessionOptions(normalized, { lowMemory });
    sessionEntry = { key: cacheKey, queue: createRunQueue(), references: 0, retired: false,
      measurements: { scope: 'shared-session-lifetime', runs: 0, failures: 0, active: 0,
        peakActive: 0, providerBusyMs: 0, queueWaitMs: 0, initializationMs: 0, tokenizerMs: 0 },
      lastAccessAt: now, expiresAt: now + ONNX_CACHE_TTL_MS, promise: null };
    const creatingEntry = sessionEntry;
    const initializationStartedAt = performance.now();
    const promise = (async () => {
      const { AutoTokenizer, env } = await import('@huggingface/transformers');
      if (modelsDir) {
        env.cacheDir = modelsDir;
      }
      const tokenizer = await AutoTokenizer.from_pretrained(tokenizerId, modelsDir ? { cache_dir: modelsDir } : {});
      const { InferenceSession, Tensor } = await import('onnxruntime-node');
      let session;
      let effectiveSessionOptions = sessionOptions;
      try {
        session = await InferenceSession.create(resolvedModelPath, sessionOptions);
      } catch (err) {
        if (!lowMemory) {
          const fallbackOptions = buildSessionOptions(normalized, { lowMemory: true });
          effectiveSessionOptions = fallbackOptions;
          session = await InferenceSession.create(resolvedModelPath, fallbackOptions);
        } else {
          throw err;
        }
      }
      try {
        const observedArtifact = await resolveEmbeddingArtifactIdentityAsync({ provider: 'onnx', modelId, modelsDir, rootDir, onnx: normalized }, { phase: 'loaded' });
        if (embeddingArtifactReusable(selectedArtifact)) assertEmbeddingArtifactCompatibility(selectedArtifact, observedArtifact);
        return { tokenizer, session, Tensor, observedArtifact, effectiveSessionOptions };
      } catch (error) {
        try { await session.release?.(); } catch { /* Preserve artifact verification failure. */ }
        throw error;
      }
    })().then((loaded) => { creatingEntry.measurements.initializationMs = performance.now() - initializationStartedAt; creatingEntry.loaded = loaded; return loaded; }).catch((err) => {
      if (onnxCache.get(cacheKey) === creatingEntry) onnxCache.delete(cacheKey);
      throw err;
    });
    sessionEntry.promise = promise;
    onnxCache.set(cacheKey, sessionEntry);
    pruneOnnxCache(now);
  }
  sessionEntry.references += 1;
  const embedderPromise = sessionEntry.promise;
  const ownerToken = {};
  let disposed = false;
  let disposePromise = null;
  const operations = new Set();
  const ownOperation = (fn) => (...args) => {
    if (disposed) return Promise.reject(new Error('ONNX adapter is disposed.'));
    const work = Promise.resolve().then(() => fn(...args));
    operations.add(work);
    work.then(() => operations.delete(work), () => operations.delete(work));
    return work;
  };
  const tokenizationCache = {
    enabled: normalized.tokenizationCacheEnabled !== false,
    maxEntries: normalized.tokenizationCacheMaxEntries || ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES,
    cache: new Map()
  };
  const runScratch = new Map();
  const preparedRows = createPreparedTokenRows();
  // Every adapter for this native session enters the same run queue.
  const queueSessionRun = (step) => {
    const enqueuedAt = performance.now();
    return sessionEntry.queue(() => {
      sessionEntry.measurements.queueWaitMs += performance.now() - enqueuedAt;
      return step();
    });
  };
  const runSession = async (session, feeds) => {
    const stats = sessionEntry.measurements;
    stats.runs++; stats.active++; stats.peakActive = Math.max(stats.peakActive, stats.active);
    const started = performance.now();
    try { return await session.run(feeds); }
    catch (error) { stats.failures++; throw error; }
    finally { stats.active--; stats.providerBusyMs += performance.now() - started; }
  };
  const encodeTexts = (tokenizer, session, texts) => {
    const wantsTokenTypeIds = Array.isArray(session.inputNames)
      && session.inputNames.includes('token_type_ids');
    const startedAt = performance.now();
    const encoded = tokenizeBatchWithCache({
      tokenizer,
      texts,
      wantsTokenTypeIds,
      truncation: DEFAULT_EMBEDDING_TRUNCATION,
      tokenizationCache: tokenizationCache.enabled ? tokenizationCache : null,
      preparedRows
    });
    sessionEntry.measurements.tokenizerMs += performance.now() - startedAt;
    return encoded;
  };
  const getEmbeddings = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const { tokenizer, session, Tensor } = await embedderPromise;
    const encoded = encodeTexts(tokenizer, session, list);
    const outputs = await queueSessionRun(() => {
      const feeds = buildFeeds(session, encoded, Tensor, runScratch);
      if (!Object.keys(feeds).length) return null;
      return runSession(session, feeds);
    });
    if (!outputs) return Array.from({ length: list.length }, () => []);
    const mainOutput = findOutput(outputs);
    if (!mainOutput) return Array.from({ length: list.length }, () => []);
    if (Array.isArray(mainOutput?.dims) && mainOutput.dims.length === 2) {
      return rowsFromTensor(mainOutput, normalizeVec);
    }
    const mask = encoded.attention_mask;
    return meanPool(mainOutput, mask, normalizeVec);
  };
  const estimateTokens = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const { tokenizer, session } = await embedderPromise;
    const wantsTokenTypeIds = session.inputNames?.includes('token_type_ids') === true;
    const startedAt = performance.now();
    const rows = prepareTokenRowsWithCache({ tokenizer, texts: list, wantsTokenTypeIds,
      truncation: DEFAULT_EMBEDDING_TRUNCATION, tokenizationCache: tokenizationCache.enabled ? tokenizationCache : null });
    sessionEntry.measurements.tokenizerMs += performance.now() - startedAt;
    const counts = new Array(list.length);
    for (let i = 0; i < list.length; i += 1) {
      const row = rows[i]?.attention_mask || [];
      let tokenCount = 0;
      for (let j = 0; j < row.length; j += 1) {
        tokenCount += Number(row[j]) ? 1 : 0;
      }
      counts[i] = Math.max(1, tokenCount);
    }
    Object.defineProperty(counts, 'release', { value: preparedRows.retain(list, rows, wantsTokenTypeIds) });
    return counts;
  };
  const prewarm = async ({ tokenizer = true, model = false, texts = null } = {}) => {
    const shouldWarmTokenizer = tokenizer !== false;
    const shouldWarmModel = model === true;
    if (!shouldWarmTokenizer && !shouldWarmModel) return;
    const list = resolvePrewarmList(texts, normalized.prewarmTexts);
    if (!list.length) return;
    const { tokenizer: tokenizerImpl, session, Tensor } = await embedderPromise;
    const encoded = encodeTexts(tokenizerImpl, session, list);
    if (!shouldWarmModel) return;
    await queueSessionRun(() => {
      const feeds = buildFeeds(session, encoded, Tensor, runScratch);
      if (!Object.keys(feeds).length) return null;
      return runSession(session, feeds);
    });
  };
  const adapter = {
    embedderPromise,
    executionInfo: () => ({ provider: 'onnx', measurements: { ...sessionEntry.measurements }, modelArtifact: sessionEntry.loaded?.observedArtifact || selectedArtifact,
      modelRevision: selectedArtifact.revision, effectiveSessionOptions: sessionEntry.loaded?.effectiveSessionOptions ?? null, requestedSessionOptions: buildSessionOptions(normalized, { lowMemory }),
      effectiveNativeThreads: null, device: null, maxConcurrentInference: 1 }),
    getEmbeddings: ownOperation(getEmbeddings),
    estimateTokens: ownOperation(estimateTokens),
    prewarm: ownOperation(prewarm),
    dispose() {
      if (!disposePromise) {
        disposed = true;
        sessionOwners.unregister(ownerToken);
        disposePromise = Promise.allSettled([...operations]).then(() => {
          tokenizationCache.cache.clear();
          preparedRows.clear();
          runScratch.clear();
          return releaseEntry(sessionEntry);
        });
      }
      return disposePromise;
    },
    getEmbedding: async (text) => {
      const list = await adapter.getEmbeddings([text]);
      return list[0] || [];
    }
  };
  sessionOwners.register(adapter, sessionEntry, ownerToken);
  return adapter;
}
