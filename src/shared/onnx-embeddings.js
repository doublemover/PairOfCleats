import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_EMBEDDING_TRUNCATION, normalizeEmbeddingVectorInPlace } from './embedding-utils.js';
import { isAbsolutePathNative } from './files.js';

const GRAPH_LEVELS = new Set(['disabled', 'basic', 'extended', 'all']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
const ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES = 256;
const ONNX_TOKENIZATION_CACHE_MAX_ENTRIES_CAP = 4096;
const DEFAULT_PREWARM_TEXTS = Object.freeze(['pairofcleats prewarm']);
const PREWARM_TOKENIZER_ENV = 'PAIROFCLEATS_ONNX_PREWARM_TOKENIZER';
const PREWARM_MODEL_ENV = 'PAIROFCLEATS_ONNX_PREWARM_MODEL';
const PREWARM_TEXTS_ENV = 'PAIROFCLEATS_ONNX_PREWARM_TEXTS';
const TOKENIZATION_CACHE_ENABLED_ENV = 'PAIROFCLEATS_ONNX_TOKENIZATION_CACHE';
const TOKENIZATION_CACHE_MAX_ENV = 'PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX';
const CPU_EP_TUNING_ENV = 'PAIROFCLEATS_ONNX_CPU_EP_TUNING';
const PROVIDER_ALIASES = new Map([
  ['onnx', 'onnx'],
  ['onnxruntime', 'onnx'],
  ['onnxruntime-node', 'onnx'],
  ['xenova', 'xenova'],
  ['transformers', 'xenova']
]);

const normalizeProvider = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return PROVIDER_ALIASES.get(trimmed) || null;
};

const normalizeProviders = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return null;
};

const normalizeThread = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeBoundedInt = (value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return null;
  return Math.min(max, Math.floor(parsed));
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
};

const resolveBooleanOption = (configValue, envName, fallback) => {
  const envValue = normalizeBoolean(process?.env?.[envName]);
  if (envValue != null) return envValue;
  const normalizedConfigValue = normalizeBoolean(configValue);
  if (normalizedConfigValue != null) return normalizedConfigValue;
  return fallback;
};

const resolveBoundedIntOption = (configValue, envName, fallback, bounds) => {
  const envValue = normalizeBoundedInt(process?.env?.[envName], bounds);
  if (envValue != null) return envValue;
  const normalizedConfigValue = normalizeBoundedInt(configValue, bounds);
  if (normalizedConfigValue != null) return normalizedConfigValue;
  return fallback;
};

const normalizeGraphLevel = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return GRAPH_LEVELS.has(normalized) ? normalized : null;
};

const normalizeTextRows = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  return value.split(/[\r\n,]+/);
};

const normalizePrewarmTexts = (value) => {
  const rows = normalizeTextRows(value);
  if (!rows) return null;
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const text = typeof row === 'string' ? row.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.length ? out : null;
};

const LARGE_MODEL_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);

const statSize = (filePath) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
};

export function normalizeOnnxConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const executionProviders = normalizeProviders(config.executionProviders);
  const prewarmTokenizer = resolveBooleanOption(config.prewarmTokenizer, PREWARM_TOKENIZER_ENV, false);
  const prewarmModel = resolveBooleanOption(config.prewarmModel, PREWARM_MODEL_ENV, false);
  const envPrewarmTexts = normalizePrewarmTexts(process?.env?.[PREWARM_TEXTS_ENV]);
  const configPrewarmTexts = normalizePrewarmTexts(config.prewarmTexts ?? config.prewarmText);
  const prewarmTexts = envPrewarmTexts || configPrewarmTexts || null;
  return {
    modelPath: typeof config.modelPath === 'string' ? config.modelPath.trim() : '',
    tokenizerId: typeof config.tokenizerId === 'string' ? config.tokenizerId.trim() : '',
    executionProviders: executionProviders && executionProviders.length ? executionProviders : null,
    intraOpNumThreads: normalizeThread(config.intraOpNumThreads),
    interOpNumThreads: normalizeThread(config.interOpNumThreads),
    graphOptimizationLevel: normalizeGraphLevel(config.graphOptimizationLevel),
    cpuExecutionProviderTuning: resolveBooleanOption(config.cpuExecutionProviderTuning, CPU_EP_TUNING_ENV, true),
    tokenizationCacheEnabled: resolveBooleanOption(config.tokenizationCacheEnabled, TOKENIZATION_CACHE_ENABLED_ENV, true),
    tokenizationCacheMaxEntries: resolveBoundedIntOption(
      config.tokenizationCacheMaxEntries,
      TOKENIZATION_CACHE_MAX_ENV,
      ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES,
      { min: 1, max: ONNX_TOKENIZATION_CACHE_MAX_ENTRIES_CAP }
    ),
    prewarmTokenizer,
    prewarmModel,
    prewarmTexts
  };
}

export function normalizeEmbeddingProvider(raw, { strict = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return 'xenova';
  const normalized = normalizeProvider(raw);
  if (normalized) return normalized;
  if (strict) {
    const candidates = Array.from(new Set(PROVIDER_ALIASES.values())).sort().join(', ');
    throw new Error(`[embeddings] Unknown provider "${raw}". Expected one of: ${candidates}.`);
  }
  return 'xenova';
}

export function resolveOnnxModelPath({ rootDir, modelPath, modelsDir, modelId }) {
  const root = rootDir ? path.resolve(rootDir) : process.cwd();
  const trimmed = typeof modelPath === 'string' ? modelPath.trim() : '';
  const tryPath = (candidate) => {
    if (!candidate || !fs.existsSync(candidate)) return null;
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        const nested = [
          path.join(candidate, 'model.onnx'),
          path.join(candidate, 'model_quantized.onnx'),
          path.join(candidate, 'onnx', 'model.onnx'),
          path.join(candidate, 'onnx', 'model_quantized.onnx')
        ];
        for (const entry of nested) {
          if (fs.existsSync(entry)) return entry;
        }
        return null;
      }
    } catch {
      return null;
    }
    return candidate;
  };
  if (trimmed) {
    const resolved = isAbsolutePathNative(trimmed) ? trimmed : path.join(root, trimmed);
    const stat = tryPath(resolved);
    if (stat) return stat;
  }
  const modelRoot = modelId && modelsDir ? path.join(modelsDir, modelId) : null;
  const candidates = [
    modelRoot ? path.join(modelRoot, 'onnx', 'model.onnx') : null,
    modelRoot ? path.join(modelRoot, 'onnx', 'model_quantized.onnx') : null,
    modelRoot ? path.join(modelRoot, 'model.onnx') : null,
    modelRoot ? path.join(modelRoot, 'model_quantized.onnx') : null
  ];
  for (const candidate of candidates) {
    const resolved = tryPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

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

export const createRunQueue = () => {
  let runQueue = Promise.resolve();
  return (runStep) => {
    const next = runQueue.then(runStep, runStep);
    runQueue = next.catch(() => {});
    return next;
  };
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

const normalizeTokenValue = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const normalizeFieldRows = (value, rowCount) => {
  if (rowCount <= 0) return [];
  const emptyRows = Array.from({ length: rowCount }, () => []);
  if (!Array.isArray(value) || !value.length) return emptyRows;
  const first = value[0];
  if (Array.isArray(first) || ArrayBuffer.isView(first)) {
    const rows = value.map((row) => Array.from(row || [], (entry) => normalizeTokenValue(entry, 0)));
    while (rows.length < rowCount) rows.push([]);
    return rows.slice(0, rowCount);
  }
  const row = Array.from(value, (entry) => normalizeTokenValue(entry, 0));
  return [row, ...Array.from({ length: rowCount - 1 }, () => [])];
};

const buildRowsFromTokenizerOutput = (encoded, rowCount, { wantsTokenTypeIds = false } = {}) => {
  const inputRows = normalizeFieldRows(encoded?.input_ids, rowCount);
  const maskRows = normalizeFieldRows(encoded?.attention_mask, rowCount);
  const tokenTypeRows = wantsTokenTypeIds
    ? normalizeFieldRows(encoded?.token_type_ids, rowCount)
    : null;
  const rows = new Array(rowCount);
  for (let i = 0; i < rowCount; i += 1) {
    const inputIds = inputRows[i] || [];
    const width = inputIds.length;
    const mask = new Array(width);
    const sourceMask = maskRows[i] || [];
    for (let c = 0; c < width; c += 1) {
      mask[c] = Number(sourceMask[c] ?? 1) ? 1 : 0;
    }
    const tokenTypeIds = wantsTokenTypeIds
      ? Array.from({ length: width }, (_, c) => normalizeTokenValue(tokenTypeRows?.[i]?.[c], 0))
      : null;
    rows[i] = {
      input_ids: inputIds,
      attention_mask: mask,
      token_type_ids: tokenTypeIds
    };
  }
  return rows;
};

const getTokenCacheValue = (cache, key) => {
  if (!cache || !cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setTokenCacheValue = (cache, key, value, maxEntries) => {
  if (!cache) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const buildTokenizationCacheKey = (text, wantsTokenTypeIds) => `${wantsTokenTypeIds ? 1 : 0}:${text}`;

const buildPaddedBatchEncoding = (rows, { wantsTokenTypeIds = false, padTokenId = 0 } = {}) => {
  const width = rows.reduce((max, row) => Math.max(max, row?.input_ids?.length || 0), 0);
  const input_ids = new Array(rows.length);
  const attention_mask = new Array(rows.length);
  const token_type_ids = wantsTokenTypeIds ? new Array(rows.length) : undefined;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || {};
    const ids = row.input_ids || [];
    const maskSrc = row.attention_mask || [];
    const tokenTypeSrc = row.token_type_ids || [];
    const idRow = new Array(width);
    const maskRow = new Array(width);
    const tokenTypeRow = wantsTokenTypeIds ? new Array(width) : null;
    for (let c = 0; c < width; c += 1) {
      const hasToken = c < ids.length;
      idRow[c] = hasToken ? normalizeTokenValue(ids[c], padTokenId) : padTokenId;
      maskRow[c] = hasToken ? (Number(maskSrc[c] ?? 1) ? 1 : 0) : 0;
      if (tokenTypeRow) {
        tokenTypeRow[c] = hasToken ? normalizeTokenValue(tokenTypeSrc[c], 0) : 0;
      }
    }
    input_ids[r] = idRow;
    attention_mask[r] = maskRow;
    if (tokenTypeRow) token_type_ids[r] = tokenTypeRow;
  }
  return {
    input_ids,
    attention_mask,
    token_type_ids
  };
};

const tokenizeBatchWithCache = ({
  tokenizer,
  texts,
  wantsTokenTypeIds = false,
  truncation = DEFAULT_EMBEDDING_TRUNCATION,
  tokenizationCache = null
}) => {
  const list = Array.isArray(texts) ? texts.map((text) => (typeof text === 'string' ? text : String(text ?? ''))) : [];
  if (!list.length) {
    return {
      input_ids: [],
      attention_mask: [],
      token_type_ids: wantsTokenTypeIds ? [] : undefined
    };
  }
  const rows = new Array(list.length);
  const missingByText = new Map();
  const cacheEnabled = tokenizationCache?.enabled === true;
  const cache = cacheEnabled ? tokenizationCache.cache : null;
  const maxEntries = cacheEnabled
    ? Math.max(1, Number(tokenizationCache.maxEntries) || ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES)
    : 0;
  for (let i = 0; i < list.length; i += 1) {
    const text = list[i];
    if (cacheEnabled) {
      const key = buildTokenizationCacheKey(text, wantsTokenTypeIds);
      const cached = getTokenCacheValue(cache, key);
      if (cached) {
        rows[i] = cached;
        continue;
      }
    }
    const current = missingByText.get(text);
    if (current) current.push(i);
    else missingByText.set(text, [i]);
  }
  if (missingByText.size) {
    const missingTexts = Array.from(missingByText.keys());
    const encodedMissing = tokenizer(missingTexts, {
      padding: false,
      truncation,
      return_tensor: false,
      return_token_type_ids: wantsTokenTypeIds
    });
    const missingRows = buildRowsFromTokenizerOutput(encodedMissing, missingTexts.length, {
      wantsTokenTypeIds
    });
    for (let i = 0; i < missingTexts.length; i += 1) {
      const text = missingTexts[i];
      const row = missingRows[i] || {
        input_ids: [],
        attention_mask: [],
        token_type_ids: wantsTokenTypeIds ? [] : null
      };
      if (cacheEnabled) {
        const key = buildTokenizationCacheKey(text, wantsTokenTypeIds);
        setTokenCacheValue(cache, key, row, maxEntries);
      }
      const indexes = missingByText.get(text) || [];
      for (const index of indexes) {
        rows[index] = row;
      }
    }
  }
  const padTokenId = normalizeTokenValue(tokenizer?.pad_token_id, 0);
  return buildPaddedBatchEncoding(rows, { wantsTokenTypeIds, padTokenId });
};

export const __tokenizeBatchWithCacheForTests = (input = {}) => tokenizeBatchWithCache(input);

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

const resolvePrewarmList = (texts, fallbackTexts = null) => {
  const override = normalizePrewarmTexts(texts);
  if (override && override.length) return override;
  if (Array.isArray(fallbackTexts) && fallbackTexts.length) return fallbackTexts.slice();
  return DEFAULT_PREWARM_TEXTS.slice();
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
