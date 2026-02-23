export const PRESSURE_STATE_NORMAL = 'normal';
const PRESSURE_STATE_SOFT = 'soft-pressure';
const PRESSURE_STATE_HARD = 'hard-pressure';
const PRESSURE_STATES = new Set([
  PRESSURE_STATE_NORMAL,
  PRESSURE_STATE_SOFT,
  PRESSURE_STATE_HARD
]);

export const clampRatio = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
};

export const normalizeLanguageId = (value) => (
  typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : ''
);

const toFiniteTimestamp = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Collapse raw RSS/heap pressure into a hysteresis-aware pressure state.
 *
 * Hysteresis prevents flapping between states when pressure hovers near the
 * threshold boundaries.
 *
 * @param {object} input
 * @param {number} input.pressureRatio
 * @param {number} [input.watermarkSoft]
 * @param {number} [input.watermarkHard]
 * @param {'normal'|'soft-pressure'|'hard-pressure'} [input.currentState]
 * @returns {'normal'|'soft-pressure'|'hard-pressure'}
 */
export const resolveMemoryPressureState = ({
  pressureRatio,
  watermarkSoft = 0.985,
  watermarkHard = 0.995,
  currentState = PRESSURE_STATE_NORMAL
}) => {
  const ratio = clampRatio(pressureRatio);
  const soft = clampRatio(watermarkSoft);
  const hard = Math.max(soft, clampRatio(watermarkHard));
  const prior = PRESSURE_STATES.has(currentState) ? currentState : PRESSURE_STATE_NORMAL;
  const softRecover = Math.max(0, soft - 0.02);
  const hardRecover = Math.max(softRecover, hard - 0.02);
  if (prior === PRESSURE_STATE_HARD) {
    if (ratio >= hardRecover) return PRESSURE_STATE_HARD;
    if (ratio >= softRecover) return PRESSURE_STATE_SOFT;
    return PRESSURE_STATE_NORMAL;
  }
  if (prior === PRESSURE_STATE_SOFT) {
    if (ratio >= hard) return PRESSURE_STATE_HARD;
    if (ratio >= softRecover) return PRESSURE_STATE_SOFT;
    return PRESSURE_STATE_NORMAL;
  }
  if (ratio >= hard) return PRESSURE_STATE_HARD;
  if (ratio >= soft) return PRESSURE_STATE_SOFT;
  return PRESSURE_STATE_NORMAL;
};

/**
 * Resolve the per-language concurrency limit under memory pressure.
 *
 * Heavy languages can be throttled (or blocked) while pressure is elevated;
 * non-heavy languages remain effectively unbounded so the queue can continue
 * draining lighter work.
 *
 * @param {object} input
 * @param {'normal'|'soft-pressure'|'hard-pressure'} [input.pressureState]
 * @param {string} [input.languageId]
 * @param {object} [input.throttleConfig]
 * @returns {number}
 */
export const resolveLanguageThrottleLimit = ({
  pressureState = PRESSURE_STATE_NORMAL,
  languageId = '',
  throttleConfig = {}
}) => {
  if (throttleConfig?.enabled === false) return Number.POSITIVE_INFINITY;
  const state = PRESSURE_STATES.has(pressureState) ? pressureState : PRESSURE_STATE_NORMAL;
  if (state === PRESSURE_STATE_NORMAL) return Number.POSITIVE_INFINITY;
  const normalizedLanguageId = normalizeLanguageId(languageId);
  const heavyLanguages = throttleConfig?.heavyLanguages instanceof Set
    ? throttleConfig.heavyLanguages
    : new Set(
      Array.isArray(throttleConfig?.heavyLanguages)
        ? throttleConfig.heavyLanguages.map((entry) => normalizeLanguageId(entry)).filter(Boolean)
        : []
    );
  const softMax = Number.isFinite(Number(throttleConfig?.softMaxPerLanguage))
    ? Math.max(1, Math.floor(Number(throttleConfig.softMaxPerLanguage)))
    : 6;
  const hardMax = Number.isFinite(Number(throttleConfig?.hardMaxPerLanguage))
    ? Math.max(0, Math.floor(Number(throttleConfig.hardMaxPerLanguage)))
    : 3;
  const normalizedHardMax = Math.min(softMax, Math.max(0, hardMax));
  const isHeavyLanguage = heavyLanguages.has(normalizedLanguageId);
  const blockHeavyOnHardPressure = throttleConfig?.blockHeavyOnHardPressure !== false;
  if (state === PRESSURE_STATE_HARD) {
    if (!isHeavyLanguage) return Number.POSITIVE_INFINITY;
    if (blockHeavyOnHardPressure) return 0;
    return normalizedHardMax;
  }
  if (!isHeavyLanguage) return Number.POSITIVE_INFINITY;
  return softMax;
};

/**
 * Deterministically evict pressure-cache entries to a target size.
 *
 * Eviction order is stable: larger entries first, then older entries, then key
 * name. This keeps behavior reproducible across runs and test environments.
 *
 * @param {object} input
 * @param {Map<string,{sizeBytes?:number,firstSeenAt?:number}>} input.cache
 * @param {number} input.maxEntries
 * @returns {Array<{key:string,sizeBytes:number,firstSeenAt:number}>}
 */
export const evictDeterministicPressureCacheEntries = ({
  cache,
  maxEntries
}) => {
  if (!(cache instanceof Map)) return [];
  const normalizedMaxEntries = Number.isFinite(Number(maxEntries))
    ? Math.max(1, Math.floor(Number(maxEntries)))
    : 0;
  if (!normalizedMaxEntries || cache.size <= normalizedMaxEntries) return [];
  const overflow = cache.size - normalizedMaxEntries;
  const ranked = Array.from(cache.entries())
    .map(([key, value]) => {
      const sizeBytes = Number(value?.sizeBytes);
      return {
        key,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
        firstSeenAt: toFiniteTimestamp(value?.firstSeenAt, 0)
      };
    })
    .sort((a, b) => {
      if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
      if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt - b.firstSeenAt;
      return String(a.key).localeCompare(String(b.key));
    });
  const evicted = [];
  for (let i = 0; i < overflow; i += 1) {
    const entry = ranked[i];
    if (!entry) break;
    if (cache.delete(entry.key)) {
      evicted.push({
        key: entry.key,
        sizeBytes: entry.sizeBytes,
        firstSeenAt: entry.firstSeenAt
      });
    }
  }
  return evicted;
};
