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
  const queryPrefix = normalizeModel(value.queryPrefix);
  const passagePrefix = normalizeModel(value.passagePrefix);
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
  const quantization = meta.quantization && typeof meta.quantization === 'object'
    ? meta.quantization
    : null;
  const identity = {};
  const dims = normalizeIdentityNumber(meta.dims);
  if (dims != null) identity.dims = dims;
  const model = normalizeModel(meta.model) || normalizeModel(meta.modelId);
  if (model != null) identity.model = model;
  const scale = normalizeIdentityNumber(meta.scale);
  if (scale != null) identity.scale = scale;
  const minVal = normalizeIdentityNumber(meta.minVal ?? quantization?.minVal);
  if (minVal != null) identity.minVal = minVal;
  const maxVal = normalizeIdentityNumber(meta.maxVal ?? quantization?.maxVal);
  if (maxVal != null) identity.maxVal = maxVal;
  const levels = normalizeIdentityNumber(meta.levels ?? quantization?.levels);
  if (levels != null) identity.levels = levels;
  const inputFormatting = normalizeIdentityInputFormatting(meta.inputFormatting);
  if (inputFormatting) identity.inputFormatting = inputFormatting;
  return identity;
};

export { hasOwn };
