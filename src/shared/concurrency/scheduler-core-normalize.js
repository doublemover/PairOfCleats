/**
 * Normalize requested token pool size to scheduler-safe bounds.
 *
 * @param {unknown} value
 * @returns {number}
 */
export const normalizeTokenPool = (value) => {
  if (value == null) return 1;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 1;
  // Zero-token pools deadlock queued work that requires that resource.
  return Math.max(1, parsed);
};

export const normalizeByteLimit = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeByteCount = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const normalizeRequest = (req = {}) => ({
  cpu: Math.max(0, Math.floor(Number(req?.cpu || 0))),
  io: Math.max(0, Math.floor(Number(req?.io || 0))),
  mem: Math.max(0, Math.floor(Number(req?.mem || 0))),
  bytes: normalizeByteCount(req?.bytes)
});

export const resolvePercentile = (values, ratio) => {
  if (!Array.isArray(values) || !values.length) return 0;
  const normalized = values
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .sort((a, b) => a - b);
  if (!normalized.length) return 0;
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.min(normalized.length - 1, Math.max(0, Math.ceil(normalized.length * clamped) - 1));
  return normalized[index];
};

export const normalizeSurfaceName = (value) => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

export const normalizePositiveInt = (value, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

export const normalizeNonNegativeInt = (value, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

export const normalizeRatio = (
  value,
  fallback,
  { min = 0, max = Number.POSITIVE_INFINITY } = {}
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

export const normalizeCooldownMs = (value, fallback = 0) => (
  Math.max(0, normalizeNonNegativeInt(value, fallback) ?? fallback)
);

export const normalizeBacklogRatio = (value, fallback, min = 0) => (
  Math.max(min, normalizeRatio(value, fallback, { min, max: 64 }) ?? fallback)
);

export const normalizeQueueName = (value) => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);
