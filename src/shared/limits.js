export const normalizeOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeOptionalInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

export const normalizeOptionalNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
};

export const normalizeNonNegativeInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

export const normalizePositiveNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

export const normalizePositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const normalizeCap = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

export const normalizeDepth = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

export const normalizeLimit = (value, fallback = null) => (
  normalizeNonNegativeInt(value, fallback)
);

export const normalizeOptionalLimit = (value) => (
  normalizeOptionalNonNegativeInt(value)
);

export const normalizeCapNullOnZero = (value, fallback = null) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};
