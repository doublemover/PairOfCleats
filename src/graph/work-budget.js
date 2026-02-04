import { normalizeOptionalNonNegativeInt } from '../shared/limits.js';

const normalizeLimit = (value) => (
  value == null ? null : normalizeOptionalNonNegativeInt(value)
);

const normalizeCadence = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const createWorkBudget = ({
  maxWorkUnits,
  maxWallClockMs,
  checkEvery = 256,
  now = () => Date.now()
} = {}) => {
  const maxUnits = normalizeLimit(maxWorkUnits);
  const maxMs = normalizeLimit(maxWallClockMs);
  const cadence = normalizeCadence(checkEvery, 256);
  const startedAt = now();
  let used = 0;
  let lastCheckAt = 0;
  const state = {
    stop: false,
    reason: null,
    limit: null,
    elapsedMs: null
  };

  const consume = (units = 1) => {
    if (state.stop) return { ...state, used };
    const parsed = Number(units);
    const increment = Number.isFinite(parsed) ? Math.floor(parsed) : 1;
    used += Math.max(1, increment);
    if (maxUnits != null && used >= maxUnits) {
      state.stop = true;
      state.reason = 'maxWorkUnits';
      state.limit = maxUnits;
      state.elapsedMs = now() - startedAt;
      return { ...state, used };
    }
    if (maxMs != null && used - lastCheckAt >= cadence) {
      lastCheckAt = used;
      const elapsedMs = now() - startedAt;
      if (elapsedMs >= maxMs) {
        state.stop = true;
        state.reason = 'maxWallClockMs';
        state.limit = maxMs;
        state.elapsedMs = elapsedMs;
      }
    }
    return { ...state, used };
  };

  const shouldStop = () => state.stop;

  const buildTruncation = (scope, { observed = null, omitted = null, at = null } = {}) => {
    if (!state.stop || !state.reason) return null;
    return {
      scope,
      cap: state.reason,
      limit: state.limit,
      observed,
      omitted,
      at: at || null
    };
  };

  return {
    consume,
    shouldStop,
    buildTruncation,
    getUsed: () => used,
    getLimits: () => ({ maxWorkUnits: maxUnits, maxWallClockMs: maxMs }),
    getStartedAt: () => startedAt
  };
};

