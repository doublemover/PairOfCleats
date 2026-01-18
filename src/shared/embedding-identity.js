import { sha1 } from './hash.js';

export const EMBEDDING_IDENTITY_VERSION = 2;
export const EMBEDDING_IDENTITY_FINGERPRINT = 'embeddings-v2';

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
      graphOptimizationLevel: normalizeString(onnxConfig.graphOptimizationLevel)
    } : null
  };
  return identity;
};

export const buildEmbeddingIdentityKey = (identity) => {
  const safeIdentity = identity && typeof identity === 'object' ? identity : {};
  return sha1(JSON.stringify(safeIdentity));
};
