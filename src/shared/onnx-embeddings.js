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
  if (typeof value !== 'string') return 'xenova';
  const trimmed = value.trim().toLowerCase();
  return PROVIDER_ALIASES.get(trimmed) || 'xenova';
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

export function normalizeEmbeddingProvider(raw) {
  return normalizeProvider(raw);
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
  if (!Array.isArray(vec) || vec.length === 0) return vec || [];
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (!Number.isFinite(norm) || norm === 0) return vec;
  return vec.map((v) => v / norm);
};

const buildSessionOptions = (config) => {
  const options = {};
  if (config.executionProviders) options.executionProviders = config.executionProviders;
  if (config.intraOpNumThreads) options.intraOpNumThreads = config.intraOpNumThreads;
  if (config.interOpNumThreads) options.interOpNumThreads = config.interOpNumThreads;
  if (config.graphOptimizationLevel) {
    options.graphOptimizationLevel = config.graphOptimizationLevel;
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
    const vec = new Array(hidden).fill(0);
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
    out[r] = normalizeVec(Array.from(data.slice(start, start + cols)));
  }
  return out;
};

export function createOnnxEmbedder({ rootDir, modelId, modelsDir, onnxConfig }) {
  const normalizedProvider = normalizeEmbeddingProvider('onnx');
  if (normalizedProvider !== 'onnx') {
    throw new Error('ONNX embedder misconfigured.');
  }
  const normalized = normalizeOnnxConfig(onnxConfig);
  const resolvedModelPath = resolveOnnxModelPath({
    rootDir,
    modelPath: normalized.modelPath,
    modelsDir,
    modelId
  });
  if (!resolvedModelPath) {
    throw new Error('ONNX model path not found. Set indexing.embeddings.onnx.modelPath.');
  }
  const tokenizerId = normalized.tokenizerId || modelId;
  const cacheKey = JSON.stringify({
    resolvedModelPath,
    tokenizerId,
    executionProviders: normalized.executionProviders || null,
    intraOpNumThreads: normalized.intraOpNumThreads || null,
    interOpNumThreads: normalized.interOpNumThreads || null,
    graphOptimizationLevel: normalized.graphOptimizationLevel || null
  });
  if (!onnxCache.has(cacheKey)) {
    const sessionOptions = buildSessionOptions(normalized);
    const promise = (async () => {
      const { AutoTokenizer, env } = await import('@xenova/transformers');
      if (modelsDir) {
        env.cacheDir = modelsDir;
      }
      const tokenizer = await AutoTokenizer.from_pretrained(tokenizerId);
      const { InferenceSession, Tensor } = await import('onnxruntime-node');
      const session = await InferenceSession.create(resolvedModelPath, sessionOptions);
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
