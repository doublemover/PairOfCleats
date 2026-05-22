export const normalizeLogFormat = (value, fallback = 'text') => {
  if (value === 'text' || value === 'json' || value === 'pretty') return value;
  return fallback;
};

export const normalizeLogLevel = (value, fallback = 'info') => {
  if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  return fallback;
};

export const normalizeLogRingMax = (value, fallback = 200) => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(1, Math.floor(numeric))
    : fallback;
};

export const normalizeLogRingMaxBytes = (value, fallback = 2 * 1024 * 1024) => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(1024, Math.floor(numeric))
    : fallback;
};
