import { sha1 } from './hash.js';

/** Embedding identity schema version. */
export const EMBEDDING_IDENTITY_VERSION = 3;
/** Embedding identity fingerprint tag used in cache keys. */
export const EMBEDDING_IDENTITY_FINGERPRINT = 'embeddings-v3';

const normalizeString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const normalizeInt = (value) => {
  const parsed = normalizeNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
};

const normalizeArray = (value) => {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((entry) => String(entry).trim()).filter(Boolean);
  return normalized.length ? normalized : null;
};

const normalizeInputFormatting = (value) => {
  if (!value || typeof value !== 'object') return null;
  const family = normalizeString(value.family) || 'default';
  const queryPrefix = normalizeString(value.queryPrefix);
  const passagePrefix = normalizeString(value.passagePrefix);
  if (!queryPrefix && !passagePrefix && family === 'default') return null;
  return {
    family,
    queryPrefix: queryPrefix || null,
    passagePrefix: passagePrefix || null
  };
};

/**
 * Build a normalized embedding identity payload.
 *
 * Deterministic: identical inputs produce identical normalized output.
 * Cache behavior: identity is used to compute cache keys and invalidation.
 *
 * @param {object} options
 * @param {string} [options.modelId]
 * @param {string} [options.provider]
 * @param {string} [options.mode]
 * @param {boolean} [options.stub]
 * @param {number} [options.dims]
 * @param {number} [options.scale]
 * @param {string} [options.pooling]
 * @param {boolean} [options.normalize]
 * @param {string} [options.truncation]
 * @param {number} [options.maxLength]
 * @param {{family?:string,queryPrefix?:string|null,passagePrefix?:string|null}} [options.inputFormatting]
 * @param {object} [options.quantization]
 * @param {object} [options.onnx]
 * @returns {object}
 */
export const buildEmbeddingIdentity = ({
  modelId,
  provider,
  mode,
  stub,
  dims,
  scale,
  pooling,
  normalize,
  truncation,
  maxLength,
  inputFormatting,
  quantization,
  onnx
} = {}) => {
  const onnxConfig = onnx && typeof onnx === 'object' ? onnx : {};
  const quant = quantization && typeof quantization === 'object' ? quantization : {};
  const identity = {
    version: EMBEDDING_IDENTITY_VERSION,
    fingerprint: EMBEDDING_IDENTITY_FINGERPRINT,
    modelId: normalizeString(modelId),
    provider: normalizeString(provider),
    mode: normalizeString(mode),
    stub: stub === true,
    dims: normalizeInt(dims),
    scale: normalizeNumber(scale),
    pooling: normalizeString(pooling) || 'mean',
    normalize: normalize !== false,
    truncation: normalizeString(truncation) || 'truncate',
    maxLength: normalizeInt(maxLength),
    inputFormatting: normalizeInputFormatting(inputFormatting),
    quantization: {
      version: normalizeInt(quant.version) ?? 1,
      minVal: normalizeNumber(quant.minVal) ?? -1,
      maxVal: normalizeNumber(quant.maxVal) ?? 1,
      levels: normalizeInt(quant.levels) ?? 256
    },
    onnx: provider === 'onnx' ? {
      modelPath: normalizeString(onnxConfig.resolvedModelPath || onnxConfig.modelPath),
      tokenizerId: normalizeString(onnxConfig.tokenizerId),
      executionProviders: normalizeArray(onnxConfig.executionProviders),
      intraOpNumThreads: normalizeInt(onnxConfig.intraOpNumThreads),
      interOpNumThreads: normalizeInt(onnxConfig.interOpNumThreads),
      graphOptimizationLevel: normalizeString(onnxConfig.graphOptimizationLevel),
      cpuExecutionProviderTuning: onnxConfig.cpuExecutionProviderTuning === false ? false : true
    } : null
  };
  return identity;
};

/**
 * Compute a stable identity key for embedding cache entries.
 *
 * Deterministic: JSON stringification of normalized identity.
 *
 * @param {object} identity
 * @returns {string}
 */
export const buildEmbeddingIdentityKey = (identity) => {
  const safeIdentity = identity && typeof identity === 'object' ? identity : {};
  return sha1(JSON.stringify(safeIdentity));
};
