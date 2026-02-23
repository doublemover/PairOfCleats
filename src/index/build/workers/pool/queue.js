import {
  PRESSURE_STATE_NORMAL,
  clampRatio,
  evictDeterministicPressureCacheEntries,
  normalizeLanguageId,
  resolveLanguageThrottleLimit,
  resolveMemoryPressureState
} from './pressure-controls.js';

const THROTTLE_SIGNAL_TIMEOUT_MS = 50;

/**
 * Create queue-admission controls for memory pressure and per-language throttling.
 *
 * This module owns all shared state required to preserve backpressure semantics:
 * - pressure-state hysteresis transitions
 * - deterministic pressure cache eviction
 * - language-specific in-flight admission gates
 *
 * @param {object} [input]
 * @param {(line:string)=>void} [input.log]
 * @param {number} [input.pressureWatermarkSoft]
 * @param {number} [input.pressureWatermarkHard]
 * @param {number} [input.pressureCacheMaxEntries]
 * @param {object} [input.languageThrottleConfig]
 * @param {number} [input.maxGlobalRssBytes]
 * @returns {object}
 */
export const createWorkerPoolQueue = (input = {}) => {
  const {
    log = () => {},
    pressureWatermarkSoft = 0.985,
    pressureWatermarkHard = 0.995,
    pressureCacheMaxEntries = 2048,
    languageThrottleConfig = {},
    maxGlobalRssBytes = 0
  } = input;

  let pressureState = PRESSURE_STATE_NORMAL;
  let pressureTransitions = 0;
  let lastPressureTransitionAtMs = 0;
  let pressureThrottleWaitCount = 0;
  let pressureThrottleWaitMs = 0;
  let pressureHardBlockCount = 0;
  let pressureCacheEvictionCount = 0;
  let pressureCacheEvictionBytes = 0;
  const tokenizeInFlightByLanguage = new Map();
  const pressureThrottleWaitersByLanguage = new Map();
  const pressureCache = new Map();
  let pressureCacheOrdinal = 0;

  const resolveWaiterKey = (languageId) => (
    typeof languageId === 'string' && languageId ? languageId : '*'
  );

  const notifyWaitersForKey = (key) => {
    const waiters = pressureThrottleWaitersByLanguage.get(key);
    if (!waiters || waiters.size === 0) return;
    pressureThrottleWaitersByLanguage.delete(key);
    for (const resolve of waiters.values()) {
      try {
        resolve();
      } catch {}
    }
  };

  const notifyThrottleWaiters = (languageId = null) => {
    if (typeof languageId === 'string' && languageId) {
      notifyWaitersForKey(languageId);
    }
    notifyWaitersForKey('*');
  };

  const registerThrottleWaiter = (languageId, resolve) => {
    const key = resolveWaiterKey(languageId);
    let waiters = pressureThrottleWaitersByLanguage.get(key);
    if (!waiters) {
      waiters = new Set();
      pressureThrottleWaitersByLanguage.set(key, waiters);
    }
    waiters.add(resolve);
    return () => {
      const current = pressureThrottleWaitersByLanguage.get(key);
      if (!current) return;
      current.delete(resolve);
      if (current.size === 0) {
        pressureThrottleWaitersByLanguage.delete(key);
      }
    };
  };

  /**
   * Wait for either a language-specific release or a global pressure transition.
   *
   * Registering both wait channels preserves ordering behavior when a language
   * slot opens at the same time as a state transition. The timeout acts as a
   * bounded wake-up to guarantee forward progress during quiet periods.
   *
   * @param {string} languageId
   * @returns {Promise<void>}
   */
  const waitForThrottleSignal = (languageId) => new Promise((resolve) => {
    let settled = false;
    const onResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseLang();
      releaseAll();
      resolve();
    };
    const releaseLang = registerThrottleWaiter(languageId, onResolve);
    const releaseAll = registerThrottleWaiter('*', onResolve);
    const timer = setTimeout(onResolve, THROTTLE_SIGNAL_TIMEOUT_MS);
    if (typeof timer?.unref === 'function') timer.unref();
  });

  const updatePressureState = ({
    pressureRatio,
    rssPressure,
    gcPressure,
    reason = 'sample'
  }) => {
    const nextState = resolveMemoryPressureState({
      pressureRatio,
      watermarkSoft: pressureWatermarkSoft,
      watermarkHard: pressureWatermarkHard,
      currentState: pressureState
    });
    if (nextState === pressureState) return nextState;
    const previousState = pressureState;
    pressureState = nextState;
    pressureTransitions += 1;
    lastPressureTransitionAtMs = Date.now();
    log(
      `[workers] pressure state ${previousState}->${nextState} ` +
      `(ratio=${clampRatio(pressureRatio).toFixed(3)}, rss=${clampRatio(rssPressure).toFixed(3)}, ` +
      `heap=${clampRatio(gcPressure).toFixed(3)}, reason=${reason}).`
    );
    notifyThrottleWaiters();
    return nextState;
  };

  const readProcessPressureSample = () => {
    const usage = process.memoryUsage();
    const heapUsed = Number(usage?.heapUsed) || 0;
    const heapTotal = Number(usage?.heapTotal) || 0;
    const rss = Number(usage?.rss) || 0;
    const heapUtilization = heapTotal > 0
      ? clampRatio(heapUsed / heapTotal)
      : 0;
    const rssPressure = maxGlobalRssBytes
      ? clampRatio(rss / maxGlobalRssBytes)
      : 0;
    const pressureRatio = clampRatio(Math.max(heapUtilization, rssPressure));
    return { heapUsed, heapTotal, rss, heapUtilization, rssPressure, pressureRatio };
  };

  const resolvePayloadSizeBytes = (payload) => {
    if (payload && Number.isFinite(Number(payload.size)) && Number(payload.size) >= 0) {
      return Math.floor(Number(payload.size));
    }
    if (typeof payload?.text === 'string') {
      return Buffer.byteLength(payload.text, 'utf8');
    }
    return 0;
  };

  const recordPressureCacheEntry = (payload) => {
    if (!(pressureCache instanceof Map)) return;
    const languageId = normalizeLanguageId(payload?.languageId);
    const mode = typeof payload?.mode === 'string' ? payload.mode.toLowerCase() : '';
    if (!languageId || mode !== 'code') return;
    const fileKey = typeof payload?.file === 'string' && payload.file.trim()
      ? payload.file.trim()
      : null;
    const key = fileKey || `${languageId}:anon:${pressureCacheOrdinal++}`;
    const sizeBytes = resolvePayloadSizeBytes(payload);
    const prior = pressureCache.get(key);
    pressureCache.set(key, {
      languageId,
      sizeBytes,
      firstSeenAt: prior?.firstSeenAt ?? Date.now()
    });
    const evicted = evictDeterministicPressureCacheEntries({
      cache: pressureCache,
      maxEntries: pressureCacheMaxEntries
    });
    if (!evicted.length) return;
    pressureCacheEvictionCount += evicted.length;
    for (const entry of evicted) {
      pressureCacheEvictionBytes += Number(entry?.sizeBytes) || 0;
    }
  };

  /**
   * Acquire an admission slot for a tokenize payload.
   *
   * Admission is intentionally loop-based instead of queue-based: each wake-up
   * re-evaluates the latest pressure sample and language limits to preserve the
   * original race behavior between worker completions and pressure transitions.
   *
   * @param {object} payload
   * @returns {Promise<{languageId:string,limit:number}|null>}
   */
  const acquireLanguageThrottleSlot = async (payload) => {
    const languageId = normalizeLanguageId(payload?.languageId);
    const mode = typeof payload?.mode === 'string' ? payload.mode.toLowerCase() : '';
    if (!languageId || mode !== 'code') return null;
    while (true) {
      const sample = readProcessPressureSample();
      updatePressureState({
        pressureRatio: sample.pressureRatio,
        rssPressure: sample.rssPressure,
        gcPressure: sample.heapUtilization,
        reason: 'tokenize-admission'
      });
      const limit = resolveLanguageThrottleLimit({
        pressureState,
        languageId,
        throttleConfig: languageThrottleConfig
      });
      const active = Number(tokenizeInFlightByLanguage.get(languageId) || 0);
      if (!Number.isFinite(limit) || active < limit) {
        tokenizeInFlightByLanguage.set(languageId, active + 1);
        return { languageId, limit };
      }
      if (limit === 0) {
        pressureHardBlockCount += 1;
      }
      const waitStart = Date.now();
      await waitForThrottleSignal(languageId);
      pressureThrottleWaitCount += 1;
      pressureThrottleWaitMs += Math.max(0, Date.now() - waitStart);
    }
  };

  const releaseLanguageThrottleSlot = (slot) => {
    const languageId = normalizeLanguageId(slot?.languageId);
    if (!languageId) return;
    const current = Number(tokenizeInFlightByLanguage.get(languageId) || 0);
    if (current <= 1) {
      tokenizeInFlightByLanguage.delete(languageId);
    } else {
      tokenizeInFlightByLanguage.set(languageId, current - 1);
    }
    // Wake language-specific waiters and global waiters so callers blocked on a
    // pressure-state transition or language slot both get a chance to re-check
    // admission in the same turn.
    notifyThrottleWaiters(languageId);
  };

  const snapshot = () => ({
    state: pressureState,
    transitions: pressureTransitions,
    lastTransitionAt: lastPressureTransitionAtMs
      ? new Date(lastPressureTransitionAtMs).toISOString()
      : null,
    watermarkSoft: pressureWatermarkSoft,
    watermarkHard: pressureWatermarkHard,
    languageThrottle: {
      enabled: languageThrottleConfig.enabled !== false,
      heavyLanguages: Array.from(languageThrottleConfig.heavyLanguages || []),
      softMaxPerLanguage: languageThrottleConfig.softMaxPerLanguage,
      hardMaxPerLanguage: languageThrottleConfig.hardMaxPerLanguage,
      blockHeavyOnHardPressure: languageThrottleConfig.blockHeavyOnHardPressure !== false,
      waitCount: pressureThrottleWaitCount,
      waitMs: pressureThrottleWaitMs,
      hardBlockCount: pressureHardBlockCount,
      activeByLanguage: Object.fromEntries(tokenizeInFlightByLanguage.entries())
    },
    cacheEviction: {
      maxEntries: pressureCacheMaxEntries,
      entries: pressureCache.size,
      evictions: pressureCacheEvictionCount,
      evictedBytes: pressureCacheEvictionBytes
    }
  });

  return {
    notifyThrottleWaiters,
    readProcessPressureSample,
    updatePressureState,
    recordPressureCacheEntry,
    acquireLanguageThrottleSlot,
    releaseLanguageThrottleSlot,
    snapshot
  };
};
