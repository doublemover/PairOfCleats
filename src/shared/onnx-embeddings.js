import path from 'node:path';
import { normalizeEmbeddingVectorInPlace } from './embedding-utils.js';
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
import { __tokenizeBatchWithCacheForTests, tokenizeBatchWithCache } from './onnx-embeddings/tokenization.js';

export {
  normalizeEmbeddingProvider,
  normalizeOnnxConfig,
  resolveOnnxModelPath
} from './onnx-embeddings/config.js';
export { createRunQueue } from './onnx-embeddings/run-queue.js';
export { __tokenizeBatchWithCacheForTests } from './onnx-embeddings/tokenization.js';

const ONNX_CACHE_TTL_MS = 15 * 60 * 1000;
const ONNX_CACHE_MAX_ENTRIES = 8;
const onnxCache = new Map();

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
      onnxCache.delete(key);
    }
  }
  if (onnxCache.size <= ONNX_CACHE_MAX_ENTRIES) return;
  const overflow = onnxCache.size - ONNX_CACHE_MAX_ENTRIES;
  const oldest = Array.from(onnxCache.entries())
    .sort((a, b) => (a[1]?.lastAccessAt || 0) - (b[1]?.lastAccessAt || 0))
    .slice(0, overflow);
  for (const [key] of oldest) {
    onnxCache.delete(key);
  }
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
    const tensor = toTensor(TensorCtor, values, scratch);
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

export function createOnnxEmbedder({ rootDir, modelId, modelsDir, onnxConfig, normalize }) {
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
  const modelSize = statSize(resolvedModelPath);
  const lowMemory = Number.isFinite(modelSize) && modelSize >= LARGE_MODEL_BYTES;
  const tokenizerId = normalized.tokenizerId || modelId;
  const cacheKey = JSON.stringify({
    resolvedModelPath,
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
  const cached = onnxCache.get(cacheKey);
  if (cached) {
    touchCacheEntry(cached, now);
  } else {
    const sessionOptions = buildSessionOptions(normalized, { lowMemory });
    const promise = (async () => {
      const { AutoTokenizer, env } = await import('@xenova/transformers');
      if (modelsDir) {
        env.cacheDir = modelsDir;
      }
      const tokenizer = await AutoTokenizer.from_pretrained(tokenizerId);
      const { InferenceSession, Tensor } = await import('onnxruntime-node');
      let session;
      try {
        session = await InferenceSession.create(resolvedModelPath, sessionOptions);
      } catch (err) {
        if (!lowMemory) {
          const fallbackOptions = buildSessionOptions(normalized, { lowMemory: true });
          session = await InferenceSession.create(resolvedModelPath, fallbackOptions);
        } else {
          throw err;
        }
      }
      return { tokenizer, session, Tensor };
    })().catch((err) => {
      onnxCache.delete(cacheKey);
      throw err;
    });
    onnxCache.set(cacheKey, {
      promise,
      lastAccessAt: now,
      expiresAt: now + ONNX_CACHE_TTL_MS
    });
    pruneOnnxCache(now);
  }
  const embedderPromise = onnxCache.get(cacheKey)?.promise || null;
  const tokenizationCache = {
    enabled: normalized.tokenizationCacheEnabled !== false,
    maxEntries: normalized.tokenizationCacheMaxEntries || ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES,
    cache: new Map()
  };
  const runScratch = { data: null };
  // onnxruntime-node sessions are not guaranteed to be thread-safe.
  const queueSessionRun = createRunQueue();
  const encodeTexts = (tokenizer, session, texts) => {
    const wantsTokenTypeIds = Array.isArray(session.inputNames)
      && session.inputNames.includes('token_type_ids');
    return tokenizeBatchWithCache({
      tokenizer,
      texts,
      wantsTokenTypeIds,
      truncation: DEFAULT_EMBEDDING_TRUNCATION,
      tokenizationCache: tokenizationCache.enabled ? tokenizationCache : null
    });
  };
  const getEmbeddings = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const { tokenizer, session, Tensor } = await embedderPromise;
    const encoded = encodeTexts(tokenizer, session, list);
    const outputs = await queueSessionRun(() => {
      const feeds = buildFeeds(session, encoded, Tensor, runScratch);
      if (!Object.keys(feeds).length) return null;
      return session.run(feeds);
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
    const encoded = encodeTexts(tokenizer, session, list);
    const masks = Array.isArray(encoded?.attention_mask) ? encoded.attention_mask : [];
    const counts = new Array(list.length);
    for (let i = 0; i < list.length; i += 1) {
      const row = Array.isArray(masks[i]) ? masks[i] : [];
      let tokenCount = 0;
      for (let j = 0; j < row.length; j += 1) {
        tokenCount += Number(row[j]) ? 1 : 0;
      }
      counts[i] = Math.max(1, tokenCount);
    }
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
      return session.run(feeds);
    });
  };
  return {
    embedderPromise,
    getEmbeddings,
    estimateTokens,
    prewarm,
    getEmbedding: async (text) => {
      const list = await getEmbeddings([text]);
      return list[0] || [];
    }
  };
}
