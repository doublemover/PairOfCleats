export const normalizeSchedulerTokenPool = (value) => {
  if (value == null) return 1;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
};

export const normalizeSchedulerByteLimit = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeSchedulerMaxPending = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeSchedulerByteCount = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const normalizeSchedulerRequest = (req = {}) => ({
  cpu: Math.max(0, Math.floor(Number(req?.cpu || 0))),
  io: Math.max(0, Math.floor(Number(req?.io || 0))),
  mem: Math.max(0, Math.floor(Number(req?.mem || 0))),
  bytes: normalizeSchedulerByteCount(req?.bytes)
});

export const resolveSchedulerPercentile = (values, ratio) => {
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

export const normalizeSchedulerSurfaceName = (value) => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

export const normalizeSchedulerPositiveInt = (value, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

export const normalizeSchedulerNonNegativeInt = (value, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

export const normalizeSchedulerRatio = (
  value,
  fallback,
  { min = 0, max = Number.POSITIVE_INFINITY } = {}
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

export const normalizeSchedulerCooldownMs = (value, fallback = 0) => (
  Math.max(0, normalizeSchedulerNonNegativeInt(value, fallback) ?? fallback)
);

export const normalizeSchedulerBacklogRatio = (value, fallback, min = 0) => (
  Math.max(min, normalizeSchedulerRatio(value, fallback, { min, max: 64 }) ?? fallback)
);

export const resolveSchedulerSurfaceDefaultBounds = (surfaceName, maxLimits) => {
  const cpuHeadroom = Math.max(1, Number(maxLimits?.cpu) || 1);
  const ioHeadroom = Math.max(1, Number(maxLimits?.io) || 1);
  switch (surfaceName) {
    case 'parse':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.9)),
        initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75))
      };
    case 'inference':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75)),
        initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.5))
      };
    case 'artifactWrite':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.85)),
        initialConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.6))
      };
    case 'sqlite': {
      const sharedCap = Math.max(1, Math.min(cpuHeadroom, ioHeadroom));
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(sharedCap * 0.6)),
        initialConcurrency: Math.max(1, Math.ceil(sharedCap * 0.5))
      };
    }
    case 'embeddings':
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.8)),
        initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.55))
      };
    default:
      return {
        minConcurrency: 1,
        maxConcurrency: Math.max(1, cpuHeadroom),
        initialConcurrency: 1
      };
  }
};
