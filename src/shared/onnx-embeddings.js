import fs from 'node:fs';
import path from 'node:path';

const GRAPH_LEVELS = new Set(['disabled', 'basic', 'extended', 'all']);
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

const normalizeGraphLevel = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return GRAPH_LEVELS.has(normalized) ? normalized : null;
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
  return {
    modelPath: typeof config.modelPath === 'string' ? config.modelPath.trim() : '',
    tokenizerId: typeof config.tokenizerId === 'string' ? config.tokenizerId.trim() : '',
    executionProviders: executionProviders && executionProviders.length ? executionProviders : null,
    intraOpNumThreads: normalizeThread(config.intraOpNumThreads),
    interOpNumThreads: normalizeThread(config.interOpNumThreads),
    graphOptimizationLevel: normalizeGraphLevel(config.graphOptimizationLevel)
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
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.join(root, trimmed);
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

const onnxCache = new Map();

const normalizeVec = (vec) => {
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
};

const normalizeExecutionProviders = (providers, lowMemory) => {
  if (!providers || !lowMemory) return providers;
  return providers.map((entry) => {
    if (typeof entry === 'string') {
      return entry === 'cpu' ? { name: 'cpu', useArena: false } : entry;
    }
    if (entry && entry.name === 'cpu' && entry.useArena === undefined) {
      return { ...entry, useArena: false };
    }
    return entry;
  });
};

const buildSessionOptions = (config, { lowMemory = false } = {}) => {
  const options = {};
  const providers = normalizeExecutionProviders(config.executionProviders, lowMemory);
  if (providers && providers.length) {
    options.executionProviders = providers;
  } else if (lowMemory) {
    options.executionProviders = [{ name: 'cpu', useArena: false }];
  }
  if (config.intraOpNumThreads) options.intraOpNumThreads = config.intraOpNumThreads;
  if (config.interOpNumThreads) options.interOpNumThreads = config.interOpNumThreads;
  if (config.graphOptimizationLevel) {
    options.graphOptimizationLevel = config.graphOptimizationLevel;
  } else if (lowMemory) {
    options.graphOptimizationLevel = 'basic';
  }
  if (lowMemory) {
    options.enableCpuMemArena = false;
    options.enableMemPattern = false;
    options.executionMode = 'sequential';
  }
  return Object.keys(options).length ? options : undefined;
};

const flatten = (nested) => nested.flatMap((row) => row.map((value) => BigInt(value)));

const toTensor = (TensorCtor, rows) => {
  const batch = rows.length;
  const width = rows[0]?.length || 0;
  if (!batch || !width) return null;
  const data = BigInt64Array.from(flatten(rows));
  return new TensorCtor('int64', data, [batch, width]);
};

const buildFeeds = (session, encoded, TensorCtor) => {
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
    const tensor = toTensor(TensorCtor, values);
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

const meanPool = (tensor, attentionMask) => {
  const dims = tensor?.dims || [];
  if (dims.length !== 3) return [];
  const [batch, seq, hidden] = dims;
  const data = tensor.data || [];
  const flatMask = attentionMask ? attentionMask.flat() : new Array(batch * seq).fill(1);
  const output = new Array(batch).fill(null);
  for (let b = 0; b < batch; b += 1) {
    const vec = new Float32Array(hidden);
    let count = 0;
    for (let t = 0; t < seq; t += 1) {
      const maskVal = Number(flatMask[b * seq + t] ?? 0);
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

const rowsFromTensor = (tensor) => {
  const dims = tensor?.dims || [];
  if (dims.length !== 2) return [];
  const [rows, cols] = dims;
  const data = tensor.data || [];
  const out = new Array(rows);
  for (let r = 0; r < rows; r += 1) {
    const start = r * cols;
    out[r] = normalizeVec(data.slice(start, start + cols));
  }
  return out;
};

export function createOnnxEmbedder({ rootDir, modelId, modelsDir, onnxConfig }) {
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
      `ONNX model path not found. Set indexing.embeddings.onnx.modelPath or run tools/download-models.js (expected near ${basePath || 'models dir'}).`
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
    intraOpNumThreads: normalized.intraOpNumThreads || null,
    interOpNumThreads: normalized.interOpNumThreads || null,
    graphOptimizationLevel: normalized.graphOptimizationLevel || null
  });
  if (!onnxCache.has(cacheKey)) {
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
    })();
    onnxCache.set(cacheKey, promise);
  }
  const embedderPromise = onnxCache.get(cacheKey);
  const getEmbeddings = async (texts) => {
    const list = Array.isArray(texts) ? texts : [];
    if (!list.length) return [];
    const { tokenizer, session, Tensor } = await embedderPromise;
    const wantsTokenTypeIds = Array.isArray(session.inputNames)
      && session.inputNames.includes('token_type_ids');
    const encoded = tokenizer(list, {
      padding: true,
      truncation: true,
      return_tensor: false,
      return_token_type_ids: wantsTokenTypeIds
    });
    const feeds = buildFeeds(session, encoded, Tensor);
    if (!Object.keys(feeds).length) return Array.from({ length: list.length }, () => []);
    const outputs = await session.run(feeds);
    const mainOutput = findOutput(outputs);
    if (!mainOutput) return Array.from({ length: list.length }, () => []);
    if (Array.isArray(mainOutput?.dims) && mainOutput.dims.length === 2) {
      return rowsFromTensor(mainOutput);
    }
    const mask = encoded.attention_mask;
    return meanPool(mainOutput, mask);
  };
  return {
    embedderPromise,
    getEmbeddings,
    getEmbedding: async (text) => {
      const list = await getEmbeddings([text]);
      return list[0] || [];
    }
  };
}
