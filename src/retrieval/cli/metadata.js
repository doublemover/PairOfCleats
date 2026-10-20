const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const normalizeModel = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const normalizeIdentityNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeIdentityInputFormatting = (value) => {
  if (!value || typeof value !== 'object') return null;
  const family = normalizeModel(value.family) || 'default';
  const queryPrefix = normalizeModel(value.queryPrefix) ? value.queryPrefix : null;
  const passagePrefix = normalizeModel(value.passagePrefix) ? value.passagePrefix : null;
  if (family === 'default' && !queryPrefix && !passagePrefix) return null;
  return {
    family,
    queryPrefix: queryPrefix || null,
    passagePrefix: passagePrefix || null
  };
};

export const numbersEqual = (left, right) => Math.abs(left - right) <= 1e-9;

export const extractEmbeddingIdentity = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  const source = meta.embeddingIdentity && typeof meta.embeddingIdentity === 'object'
    && !Array.isArray(meta.embeddingIdentity) ? meta.embeddingIdentity : meta;
  const quantization = source.quantization && typeof source.quantization === 'object'
    ? source.quantization
    : null;
  const identity = {};
  const dims = normalizeIdentityNumber(source.dims);
  if (dims != null) identity.dims = dims;
  const model = normalizeModel(source.model) || normalizeModel(source.modelId);
  if (model != null) identity.model = model;
  const scale = normalizeIdentityNumber(source.scale);
  if (scale != null) identity.scale = scale;
  const minVal = normalizeIdentityNumber(source.minVal ?? quantization?.minVal);
  if (minVal != null) identity.minVal = minVal;
  const maxVal = normalizeIdentityNumber(source.maxVal ?? quantization?.maxVal);
  if (maxVal != null) identity.maxVal = maxVal;
  const levels = normalizeIdentityNumber(source.levels ?? quantization?.levels);
  if (levels != null) identity.levels = levels;
  const inputFormatting = normalizeIdentityInputFormatting(source.inputFormatting);
  if (inputFormatting) identity.inputFormatting = inputFormatting;
  for (const field of ['provider', 'mode', 'pooling', 'truncation', 'fingerprint']) {
    const value = normalizeModel(source[field]);
    if (value != null) identity[field] = value;
  }
  for (const field of ['normalize', 'stub']) {
    if (typeof source[field] === 'boolean') identity[field] = source[field];
  }
  if (source.maxLength != null) identity.maxLength = normalizeIdentityNumber(source.maxLength);
  for (const field of ['modelArtifact', 'modelProfile', 'onnx']) {
    if (source[field] && typeof source[field] === 'object' && !Array.isArray(source[field])) identity[field] = source[field];
  }
  return identity;
};

export { hasOwn };
