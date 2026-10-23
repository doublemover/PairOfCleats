import { evaluateTokenizerPressureWait, createTokenizerPressureError, TOKENIZER_PRESSURE_NO_PROGRESS_MS, TOKENIZER_PRESSURE_MAX_WAIT_MS } from './pressure-admission.js';
import { createAbortError, throwIfAborted } from '../../../../shared/abort.js';
import { withSchedulerCpuSuspended } from '../../../../shared/concurrency/scheduler-task-scope.js';
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

  const now = typeof input.now === 'function' ? input.now : () => performance.now();
  let closed = false;
  let pressureFailure = null;
  let pressureDeadline = Infinity;
  let lastProgressAt = now();
  let progressEpoch = 0;
  let reliefStatus = 'not-requested';
  let reliefError = null;
  let reliefPromise = null;
  const readDraining = () => {
    if (typeof input.readDrainState === 'function') {
      const state = input.readDrainState();
      return Number.isSafeInteger(state?.draining) && state.draining >= 0 ? state.draining : null;
    }
    return [...tokenizeInFlightByLanguage.values()].reduce((sum, count) => sum + count, 0);
  };
  const requestRelief = sample => {
    if (reliefStatus !== 'not-requested') return;
    if (typeof input.requestPressureRelief !== 'function') { reliefStatus = 'no-safe-relief-owner'; return; }
    reliefStatus = 'requested';
    try {
      reliefPromise = Promise.resolve(input.requestPressureRelief(sample)).then(() => { reliefStatus = 'settled'; }, error => {
        reliefStatus = 'failed'; reliefError = String(error?.message || error).slice(0, 512);
      });
    } catch (error) { reliefStatus = 'failed'; reliefError = String(error?.message || error).slice(0, 512); }
  };
  let pressureState = PRESSURE_STATE_NORMAL;
  let pressureTransitions = 0;
  let lastPressureTransitionAtMs = 0;
  let pressureThrottleWaitCount = 0;
  let pressureThrottleWaitMs = 0;
  let pressureHardBlockCount = 0;
  let pressureCacheEvictionCount = 0;
  let pressureCacheEvictionBytes = 0;
  const tokenizeInFlightByLanguage = new Map();
  const ownedSlots = new WeakSet();
  const pressureThrottleWaitersByLanguage = new Map();
  const pressureCache = new Map();
  let pressureCacheOrdinal = 0;

  let pressureRefreshTimer = null;
  let admissionSample = null;
  let sampleEpochReset = null;
  let pressureSamples = 0;
  let capacityWakeCount = 0;
  let globalWakeCount = 0;
  const pendingCapacityWakes = new Map();

  const notifyWaitersForKey = (key, count = Infinity, capacity = false) => {
    const waiters = pressureThrottleWaitersByLanguage.get(key);
    if (!waiters) return;
    for (const resume of [...waiters]) {
      if (count-- <= 0) break;
      waiters.delete(resume);
      if (capacity) pendingCapacityWakes.set(key, (pendingCapacityWakes.get(key) || 0) + 1);
      resume(capacity);
    }
    if (!waiters.size) pressureThrottleWaitersByLanguage.delete(key);
  };
  const notifyThrottleWaiters = (languageId = null) => {
    if (typeof languageId === 'string' && languageId) {
      capacityWakeCount++; notifyWaitersForKey(languageId, 1, true); return;
    }
    globalWakeCount++;
    for (const key of [...pressureThrottleWaitersByLanguage.keys()]) notifyWaitersForKey(key);
  };
  const stopPressureRefreshIfIdle = () => {
    if (pressureThrottleWaitersByLanguage.size || !pressureRefreshTimer) return;
    clearTimeout(pressureRefreshTimer); pressureRefreshTimer = null;
  };
  const schedulePressureRefresh = () => {
    if (closed || pressureRefreshTimer || !pressureThrottleWaitersByLanguage.size) return;
    // One referenced quiet-period refresh per owner, independent of waiter count.
    pressureRefreshTimer = setTimeout(() => {
      pressureRefreshTimer = null;
      if (closed || !pressureThrottleWaitersByLanguage.size) return;
      admissionSample = null;
      refreshPressureAdmission();
      schedulePressureRefresh();
    }, THROTTLE_SIGNAL_TIMEOUT_MS);
  };
  const waitForThrottleSignal = (languageId, signal, deadline = Infinity) => new Promise((resolve, reject) => {
    let settled = false;
    const waiters = pressureThrottleWaitersByLanguage.get(languageId) || new Set();
    const cleanup = () => {
      waiters.delete(resume);
      if (!waiters.size) pressureThrottleWaitersByLanguage.delete(languageId);
      signal?.removeEventListener('abort', onAbort);
      stopPressureRefreshIfIdle();
    };
    const resume = capacity => { if (settled) return; settled = true; cleanup(); resolve(capacity === true); };
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(createAbortError()); };
    resume.deadline = deadline; resume.progressEpoch = progressEpoch;
    pressureDeadline = Math.min(pressureDeadline, deadline);
    waiters.add(resume); pressureThrottleWaitersByLanguage.set(languageId, waiters);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort(); else schedulePressureRefresh();
  });
  const refreshPressureAdmission = () => {
    admissionSample = null;
    const sample = readAdmissionPressureSample();
    updatePressureState({ pressureRatio: sample.pressureRatio, rssPressure: sample.rssPressure,
      gcPressure: sample.heapUtilization, reason: 'throttle-refresh' });
    if (now() >= pressureDeadline) {
      pressureDeadline = Infinity;
      // Deadline scans happen only at a due deadline, not on every 50ms sample.
      for (const waiters of [...pressureThrottleWaitersByLanguage.values()]) {
        for (const resume of [...waiters]) {
          const deadline = Number.isFinite(resume.deadline) && progressEpoch > resume.progressEpoch
            ? Math.min(resume.deadline, lastProgressAt + TOKENIZER_PRESSURE_NO_PROGRESS_MS) : resume.deadline;
          if (now() >= deadline) resume(false);
          else pressureDeadline = Math.min(pressureDeadline, deadline);
        }
      }
    }
  };
  const readAdmissionPressureSample = () => {
    if (!admissionSample) admissionSample = readProcessPressureSample();
    if (!sampleEpochReset) {
      sampleEpochReset = setImmediate(() => { sampleEpochReset = null; admissionSample = null; });
      sampleEpochReset.unref?.();
    }
    return admissionSample;
  };

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
    pressureSamples++;
    const usage = input.readMemoryUsage?.() || process.memoryUsage();
    const heapUsed = Number(usage?.heapUsed) || 0;
    const heapTotal = Number(usage?.heapTotal) || 0;
    const rss = Number(input.readOwnedRssBytes?.(usage?.rss) ?? usage?.rss) || 0;
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
   * FIFO language waiters re-evaluate admission under one event-loop pressure
   * observation. Capacity release wakes one same-language contender; pressure
   * transitions reconsider every affected language through one refresh owner.
   *
   * @param {object} payload
   * @returns {Promise<{languageId:string,limit:number}|null>}
   */
  const acquireLanguageThrottleSlot = async (payload, { signal = null } = {}) => {
    throwIfAborted(signal);
    if (closed) throw createAbortError('Worker admission is closed');
    if (pressureFailure) throw pressureFailure;
    const languageId = normalizeLanguageId(payload?.languageId);
    const mode = typeof payload?.mode === 'string' ? payload.mode.toLowerCase() : '';
    if (!languageId || mode !== 'code') return null;
    let capacityAdmission = false;
    let pressureWaitStartedAt = null;
    while (true) {
      throwIfAborted(signal);
      if (closed) throw createAbortError('Worker admission is closed');
      if (pressureFailure) throw pressureFailure;
      const sample = readAdmissionPressureSample();
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
      if ((!Number.isFinite(limit) || active < limit) && (capacityAdmission || !pendingCapacityWakes.has(languageId))) {
        tokenizeInFlightByLanguage.set(languageId, active + 1);
        const slot = Object.freeze({ languageId, limit });
        ownedSlots.add(slot);
        return slot;
      }
      let deadline = Infinity;
      if (limit === 0) {
        pressureHardBlockCount += 1;
        pressureWaitStartedAt ??= now();
        requestRelief(sample);
        const draining = readDraining();
        const decision = evaluateTokenizerPressureWait({ startedAt: pressureWaitStartedAt, now: now(), lastProgressAt, draining });
        deadline = decision.deadline;
        if (decision.reason) {
          pressureFailure = createTokenizerPressureError({ reason: decision.reason, languageId,
            waitMs: decision.elapsed, noProgressMs: decision.noProgressMs, draining, progressEpoch,
            retainedAdmissionWaiters: [...pressureThrottleWaitersByLanguage.values()].reduce((sum, rows) => sum + rows.size, 0) + 1,
            heapUtilization: sample.heapUtilization, rssPressure: sample.rssPressure,
            evidenceScope: 'committed-heap-occupancy-and-owned-RSS; not proof of V8 hard-heap exhaustion',
            reliefStatus, reliefError, noProgressLimitMs: TOKENIZER_PRESSURE_NO_PROGRESS_MS,
            maxWaitMs: TOKENIZER_PRESSURE_MAX_WAIT_MS });
          notifyThrottleWaiters();
          throw pressureFailure;
        }
      } else pressureWaitStartedAt = null;
      const waitStart = now();
      let capacityWake;
      let capacityClaimed = false;
      const releaseCapacityWake = () => {
        if (!capacityClaimed) return;
        const pending = pendingCapacityWakes.get(languageId) || 0;
        if (pending <= 1) pendingCapacityWakes.delete(languageId); else pendingCapacityWakes.set(languageId, pending - 1);
        capacityClaimed = false;
      };
      try {
        // This is admission, not worker execution. Only the wait relinquishes
        // compute; the caller reacquires before sampling or dispatching work.
        capacityWake = await withSchedulerCpuSuspended(() => waitForThrottleSignal(languageId, signal, deadline).then(value => {
          capacityClaimed = value;
          return value;
        }));
      } finally {
        // A CPU reacquisition failure must also retire a delivered wake claim.
        releaseCapacityWake();
        pressureThrottleWaitCount += 1;
        pressureThrottleWaitMs += Math.max(0, now() - waitStart);
      }
      capacityAdmission = capacityWake;
    }
  };

  const recordWorkSettled = () => {
    lastProgressAt = now();
    progressEpoch += 1;
    // Another language/quantization task can be the final independent drain.
    // Revisit zero-slot waits after the no-progress interval, without waking
    // every contender on each release or sampling every waiter on each tick.
    if (Number.isFinite(pressureDeadline)) pressureDeadline = Math.min(pressureDeadline,
      lastProgressAt + TOKENIZER_PRESSURE_NO_PROGRESS_MS);
  };

  const releaseLanguageThrottleSlot = (slot) => {
    if (!slot || !ownedSlots.delete(slot)) return;
    const languageId = normalizeLanguageId(slot?.languageId);
    if (!languageId) return;
    const current = Number(tokenizeInFlightByLanguage.get(languageId) || 0);
    if (current > 0) recordWorkSettled();
    if (current <= 1) {
      tokenizeInFlightByLanguage.delete(languageId);
    } else {
      tokenizeInFlightByLanguage.set(languageId, current - 1);
    }
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
      pressureSamples, capacityWakeCount, globalWakeCount,
      refreshTimerCount: pressureRefreshTimer ? 1 : 0,
      waitMs: pressureThrottleWaitMs,
      hardBlockCount: pressureHardBlockCount,
      noProgressLimitMs: TOKENIZER_PRESSURE_NO_PROGRESS_MS, maxWaitMs: TOKENIZER_PRESSURE_MAX_WAIT_MS,
      progressEpoch, reliefStatus, terminalPressureReason: pressureFailure?.resourcePressure?.reason || null,
      waiting: [...pressureThrottleWaitersByLanguage.values()].reduce((sum, rows) => sum + rows.size, 0),
      activeByLanguage: Object.fromEntries(tokenizeInFlightByLanguage.entries())
    },
    cacheEviction: {
      maxEntries: pressureCacheMaxEntries,
      entries: pressureCache.size,
      evictions: pressureCacheEvictionCount,
      evictedBytes: pressureCacheEvictionBytes
    }
  });

  const close = () => {
    if (closed) return reliefPromise;
    closed = true;
    if (pressureRefreshTimer) clearTimeout(pressureRefreshTimer); pressureRefreshTimer = null;
    if (sampleEpochReset) clearImmediate(sampleEpochReset); sampleEpochReset = null; admissionSample = null;
    for (const key of [...pressureThrottleWaitersByLanguage.keys()]) notifyWaitersForKey(key);
    pendingCapacityWakes.clear();
    pressureCache.clear();
    return reliefPromise;
  };

  return {
    close,
    isClosed: () => closed,
    notifyThrottleWaiters,
    refreshPressureAdmission,
    readProcessPressureSample,
    updatePressureState,
    recordPressureCacheEntry,
    acquireLanguageThrottleSlot,
    releaseLanguageThrottleSlot,
    recordWorkSettled,
    snapshot
  };
};
