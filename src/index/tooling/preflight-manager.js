import { normalizeProviderId } from './provider-contract.js';
import {
  TOOLING_PREFLIGHT_REASON_CODES,
  TOOLING_PREFLIGHT_STATES,
  buildToolingPreflightDiagnostic,
  isValidToolingPreflightTransition,
  normalizeToolingPreflightResult
} from './preflight/contract.js';

const TOOLING_PREFLIGHT_STATE = Symbol.for('poc.tooling.preflight.state');

const PREFLIGHT_CLASS = Object.freeze({
  PROBE: 'probe',
  WORKSPACE: 'workspace',
  DEPENDENCY: 'dependency'
});
const PREFLIGHT_CLASS_SET = new Set(Object.values(PREFLIGHT_CLASS));
const DEFAULT_PREFLIGHT_TIMEOUT_BY_CLASS_MS = Object.freeze({
  [PREFLIGHT_CLASS.PROBE]: 5000,
  [PREFLIGHT_CLASS.WORKSPACE]: 20000,
  [PREFLIGHT_CLASS.DEPENDENCY]: 90000
});
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 20000;
const MIN_PREFLIGHT_TIMEOUT_MS = 250;
const MAX_PREFLIGHT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_PREFLIGHT_MAX_CONCURRENCY = 4;
const MIN_PREFLIGHT_MAX_CONCURRENCY = 1;
const MAX_PREFLIGHT_MAX_CONCURRENCY = 16;

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const toPositiveIntOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const floored = Math.floor(parsed);
  return floored > 0 ? floored : null;
};

const normalizePreflightClass = (value, fallback = PREFLIGHT_CLASS.PROBE) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (PREFLIGHT_CLASS_SET.has(normalized)) return normalized;
  return fallback;
};

const resolveProviderPreflightClass = (provider) => {
  const explicit = normalizePreflightClass(provider?.preflightClass || '', '');
  if (explicit) return explicit;
  const preflightId = String(provider?.preflightId || '').trim().toLowerCase();
  if (preflightId.includes('dependency') || preflightId.includes('package') || preflightId.includes('bootstrap')) {
    return PREFLIGHT_CLASS.DEPENDENCY;
  }
  if (preflightId.includes('workspace') || preflightId.includes('model')) {
    return PREFLIGHT_CLASS.WORKSPACE;
  }
  if (preflightId.includes('probe')) {
    return PREFLIGHT_CLASS.PROBE;
  }
  return PREFLIGHT_CLASS.PROBE;
};

const resolveSchedulerConfig = (ctx) => {
  const preflightConfig = ctx?.toolingConfig?.preflight && typeof ctx.toolingConfig.preflight === 'object'
    ? ctx.toolingConfig.preflight
    : {};
  const maxConcurrency = clampInt(
    preflightConfig.maxConcurrency,
    DEFAULT_PREFLIGHT_MAX_CONCURRENCY,
    MIN_PREFLIGHT_MAX_CONCURRENCY,
    MAX_PREFLIGHT_MAX_CONCURRENCY
  );
  const timeoutByClassRaw = preflightConfig.timeoutMsByClass && typeof preflightConfig.timeoutMsByClass === 'object'
    ? preflightConfig.timeoutMsByClass
    : {};
  const timeoutByClass = {
    [PREFLIGHT_CLASS.PROBE]: toPositiveIntOrNull(timeoutByClassRaw[PREFLIGHT_CLASS.PROBE]),
    [PREFLIGHT_CLASS.WORKSPACE]: toPositiveIntOrNull(timeoutByClassRaw[PREFLIGHT_CLASS.WORKSPACE]),
    [PREFLIGHT_CLASS.DEPENDENCY]: toPositiveIntOrNull(timeoutByClassRaw[PREFLIGHT_CLASS.DEPENDENCY])
  };
  return {
    maxConcurrency,
    timeoutMs: toPositiveIntOrNull(preflightConfig.timeoutMs),
    timeoutByClass
  };
};

const resolvePreflightTimeoutMs = ({ ctx, provider, preflightClass }) => {
  const config = resolveSchedulerConfig(ctx);
  const providerTimeout = toPositiveIntOrNull(provider?.preflightTimeoutMs);
  const classTimeout = toPositiveIntOrNull(config.timeoutByClass?.[preflightClass]);
  const globalTimeout = toPositiveIntOrNull(config.timeoutMs);
  const fallbackTimeout = toPositiveIntOrNull(DEFAULT_PREFLIGHT_TIMEOUT_BY_CLASS_MS[preflightClass])
    || DEFAULT_PREFLIGHT_TIMEOUT_MS;
  const resolved = providerTimeout || classTimeout || globalTimeout || fallbackTimeout;
  return clampInt(
    resolved,
    fallbackTimeout,
    MIN_PREFLIGHT_TIMEOUT_MS,
    MAX_PREFLIGHT_TIMEOUT_MS
  );
};

const createSchedulerMetrics = () => ({
  scheduled: 0,
  queued: 0,
  dequeued: 0,
  started: 0,
  completed: 0,
  timedOut: 0,
  failed: 0,
  queueDepthPeak: 0,
  runningPeak: 0,
  queueWaitMsTotal: 0,
  queueWaitMsMax: 0,
  queueWaitSamples: 0
});

const createState = () => ({
  inFlight: new Map(),
  completed: new Map(),
  snapshots: new Map(),
  scheduler: {
    queue: [],
    running: 0,
    maxConcurrency: DEFAULT_PREFLIGHT_MAX_CONCURRENCY,
    accepting: true,
    metrics: createSchedulerMetrics()
  }
});

const resolveState = (ctx) => {
  if (!ctx || typeof ctx !== 'object') return createState();
  if (!Object.prototype.hasOwnProperty.call(ctx, TOOLING_PREFLIGHT_STATE)) {
    Object.defineProperty(ctx, TOOLING_PREFLIGHT_STATE, {
      value: createState(),
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  return ctx[TOOLING_PREFLIGHT_STATE];
};

const resolvePreflightId = (provider) => {
  const value = provider?.preflightId;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return `${normalizeProviderId(provider?.id) || 'provider'}.preflight`;
};

const resolvePreflightKey = ({ provider, ctx, inputs }) => {
  const providerId = normalizeProviderId(provider?.id) || 'provider';
  const preflightId = resolvePreflightId(provider);
  const root = String(ctx?.repoRoot || '');
  const buildRoot = String(ctx?.buildRoot || '');
  const configHash = typeof provider?.getConfigHash === 'function'
    ? String(provider.getConfigHash(ctx) || '')
    : '';
  let customKey = '';
  if (typeof provider?.getPreflightKey === 'function') {
    customKey = String(provider.getPreflightKey(ctx, inputs) || '');
  }
  return `${providerId}::${preflightId}::${root}::${buildRoot}::${configHash}::${customKey}`;
};

const resolveLogger = (ctx) => (
  typeof ctx?.logger === 'function'
    ? ctx.logger
    : () => {}
);

const describeProvider = (provider) => (
  normalizeProviderId(provider?.id) || String(provider?.id || 'provider')
);

const createWaveToken = () => (
  `wave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

const cloneSnapshot = (snapshot) => (
  snapshot && typeof snapshot === 'object'
    ? {
      ...snapshot,
      diagnostic: snapshot.diagnostic && typeof snapshot.diagnostic === 'object'
        ? { ...snapshot.diagnostic }
        : null
    }
    : null
);

const setSnapshot = (state, key, payload = {}) => {
  const prior = state.snapshots.get(key);
  const fromState = prior?.state || TOOLING_PREFLIGHT_STATES.IDLE;
  const nextState = payload?.state || prior?.state || TOOLING_PREFLIGHT_STATES.IDLE;
  if (!isValidToolingPreflightTransition(fromState, nextState) && fromState !== nextState) {
    return prior || null;
  }
  const next = {
    ...prior,
    ...payload,
    state: nextState,
    providerId: String(payload?.providerId || prior?.providerId || ''),
    preflightId: String(payload?.preflightId || prior?.preflightId || ''),
    key
  };
  const startedAtMs = Number.isFinite(next?.startedAtMs) ? next.startedAtMs : null;
  const finishedAtMs = Number.isFinite(next?.finishedAtMs) ? next.finishedAtMs : null;
  const durationMs = (
    Number.isFinite(next?.durationMs)
      ? next.durationMs
      : (Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
        ? Math.max(0, finishedAtMs - startedAtMs)
        : null)
  );
  next.diagnostic = buildToolingPreflightDiagnostic({
    providerId: next.providerId,
    preflightId: next.preflightId,
    state: next.state,
    reasonCode: next.reasonCode,
    message: next.message,
    durationMs,
    timedOut: next.timedOut === true,
    cached: next.cached === true,
    startedAtMs,
    finishedAtMs
  });
  state.snapshots.set(key, next);
  return next;
};

const resolveSnapshotForKey = (state, key) => {
  const snapshot = state.snapshots.get(key);
  if (snapshot) return cloneSnapshot(snapshot);
  return null;
};

const isAbortSignalLike = (signal) => (
  Boolean(signal)
  && typeof signal.aborted === 'boolean'
  && typeof signal.addEventListener === 'function'
  && typeof signal.removeEventListener === 'function'
);

const resolveRequestedAbortSignal = (ctx, inputs) => {
  if (isAbortSignalLike(inputs?.abortSignal)) return inputs.abortSignal;
  if (isAbortSignalLike(ctx?.abortSignal)) return ctx.abortSignal;
  return null;
};

const createManagedAbortBridge = (upstreamSignal) => {
  if (typeof AbortController !== 'function') {
    return {
      signal: upstreamSignal || null,
      cleanup: () => {},
      abort: () => {}
    };
  }
  const controller = new AbortController();
  let detached = false;
  const abortFromUpstream = () => {
    if (controller.signal.aborted) return;
    try {
      controller.abort(upstreamSignal?.reason);
    } catch {
      controller.abort();
    }
  };
  if (isAbortSignalLike(upstreamSignal)) {
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
  }
  const cleanup = () => {
    if (detached) return;
    detached = true;
    if (isAbortSignalLike(upstreamSignal)) {
      upstreamSignal.removeEventListener('abort', abortFromUpstream);
    }
  };
  const abort = (reason) => {
    if (!controller.signal.aborted) {
      try {
        controller.abort(reason);
      } catch {
        controller.abort();
      }
    }
    cleanup();
  };
  return {
    signal: controller.signal,
    cleanup,
    abort
  };
};

const waitForPromisesWithTimeout = async (promises, timeoutMs) => {
  if (!Array.isArray(promises) || promises.length === 0) {
    return { timedOut: false, settled: [] };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const settled = await Promise.allSettled(promises);
    return { timedOut: false, settled };
  }
  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timedOut: true, settled: null }), timeoutMs);
  });
  const settledPromise = Promise.allSettled(promises)
    .then((settled) => ({ timedOut: false, settled }));
  try {
    const raced = await Promise.race([settledPromise, timeoutPromise]);
    if (raced?.timedOut === true) return { timedOut: true, settled: [] };
    return { timedOut: false, settled: Array.isArray(raced?.settled) ? raced.settled : [] };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const resolveScheduler = (state, ctx) => {
  const scheduler = state.scheduler;
  const config = resolveSchedulerConfig(ctx);
  scheduler.maxConcurrency = config.maxConcurrency;
  if (!scheduler.accepting && state.inFlight.size === 0 && scheduler.queue.length === 0) {
    scheduler.accepting = true;
  }
  return scheduler;
};

const buildSchedulerMetricsSnapshot = (state, ctx) => {
  const scheduler = resolveScheduler(state, ctx);
  const metrics = scheduler.metrics;
  return {
    maxConcurrency: scheduler.maxConcurrency,
    running: scheduler.running,
    queued: scheduler.queue.length,
    scheduled: metrics.scheduled,
    started: metrics.started,
    completed: metrics.completed,
    queuedTotal: metrics.queued,
    dequeued: metrics.dequeued,
    queueDepthPeak: metrics.queueDepthPeak,
    runningPeak: metrics.runningPeak,
    queueWaitMsAvg: metrics.queueWaitSamples > 0
      ? metrics.queueWaitMsTotal / metrics.queueWaitSamples
      : 0,
    queueWaitMsMax: metrics.queueWaitMsMax,
    queueWaitSamples: metrics.queueWaitSamples,
    timedOut: metrics.timedOut,
    failed: metrics.failed
  };
};

const createSchedulerClosedError = () => {
  const error = new Error('tooling preflight scheduler is closed');
  error.code = 'TOOLING_PREFLIGHT_SCHEDULER_CLOSED';
  return error;
};

const normalizeAbortError = (reason) => {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string' && reason.trim()) return new Error(reason.trim());
  return new Error('tooling preflight aborted');
};

const removeQueuedTask = (scheduler, task) => {
  const index = scheduler.queue.indexOf(task);
  if (index < 0) return false;
  scheduler.queue.splice(index, 1);
  return true;
};

const finalizeQueuedTaskAbort = ({ state, task, error }) => {
  if (task.settled) return;
  task.settled = true;
  setSnapshot(state, task.key, {
    providerId: task.providerId,
    preflightId: task.preflightId,
    state: TOOLING_PREFLIGHT_STATES.FAILED,
    reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
    message: error?.message || 'preflight aborted before execution.',
    startedAtMs: null,
    finishedAtMs: Date.now(),
    durationMs: 0,
    cached: false,
    timedOut: false,
    preflightClass: task.preflightClass,
    preflightTimeoutMs: task.preflightTimeoutMs
  });
  state.completed.set(task.key, {
    providerId: task.providerId,
    preflightId: task.preflightId,
    waveToken: task.waveToken,
    status: 'rejected',
    state: TOOLING_PREFLIGHT_STATES.FAILED,
    reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
    message: error?.message || 'preflight aborted before execution.',
    durationMs: 0,
    startedAtMs: null,
    finishedAtMs: Date.now(),
    timedOut: false,
    error,
    diagnostic: buildToolingPreflightDiagnostic({
      providerId: task.providerId,
      preflightId: task.preflightId,
      state: TOOLING_PREFLIGHT_STATES.FAILED,
      reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
      message: error?.message || 'preflight aborted before execution.',
      durationMs: 0,
      timedOut: false,
      cached: false,
      startedAtMs: null,
      finishedAtMs: Date.now()
    })
  });
  task.reject(error);
};

const runScheduledTask = ({ state, ctx, task, fromQueue = false }) => {
  const scheduler = resolveScheduler(state, ctx);
  const log = resolveLogger(ctx);
  scheduler.running += 1;
  scheduler.metrics.started += 1;
  scheduler.metrics.runningPeak = Math.max(scheduler.metrics.runningPeak, scheduler.running);

  if (fromQueue && Number.isFinite(task.enqueuedAtMs)) {
    const queueWaitMs = Math.max(0, Date.now() - task.enqueuedAtMs);
    scheduler.metrics.queueWaitSamples += 1;
    scheduler.metrics.queueWaitMsTotal += queueWaitMs;
    scheduler.metrics.queueWaitMsMax = Math.max(scheduler.metrics.queueWaitMsMax, queueWaitMs);
    log(
      `[tooling] preflight:dequeued provider=${task.providerId} id=${task.preflightId} `
      + `class=${task.preflightClass} waitMs=${queueWaitMs} running=${scheduler.running} cap=${scheduler.maxConcurrency}`
    );
  }

  task.started = true;
  Promise.resolve()
    .then(() => task.execute())
    .then((value) => {
      if (task.settled) return;
      task.settled = true;
      task.resolve(value);
    })
    .catch((error) => {
      if (task.settled) return;
      task.settled = true;
      task.reject(error);
    })
    .finally(() => {
      scheduler.running = Math.max(0, scheduler.running - 1);
      scheduler.metrics.completed += 1;
      while (scheduler.running < scheduler.maxConcurrency && scheduler.queue.length > 0) {
        const nextTask = scheduler.queue.shift();
        if (!nextTask || nextTask.cancelled === true || nextTask.settled) continue;
        scheduler.metrics.dequeued += 1;
        runScheduledTask({ state, ctx, task: nextTask, fromQueue: true });
      }
    });
};

const scheduleTask = ({ state, ctx, task }) => {
  const scheduler = resolveScheduler(state, ctx);
  const log = resolveLogger(ctx);
  scheduler.metrics.scheduled += 1;

  if (!scheduler.accepting) {
    const error = createSchedulerClosedError();
    finalizeQueuedTaskAbort({ state, task, error });
    return;
  }

  if (scheduler.running < scheduler.maxConcurrency) {
    runScheduledTask({ state, ctx, task, fromQueue: false });
    return;
  }

  task.enqueuedAtMs = Date.now();
  scheduler.queue.push(task);
  scheduler.metrics.queued += 1;
  scheduler.metrics.queueDepthPeak = Math.max(scheduler.metrics.queueDepthPeak, scheduler.queue.length);
  log(
    `[tooling] preflight:queued provider=${task.providerId} id=${task.preflightId} `
    + `class=${task.preflightClass} depth=${scheduler.queue.length} running=${scheduler.running} cap=${scheduler.maxConcurrency}`
  );
};

const startProviderPreflight = ({
  ctx,
  provider,
  inputs = null,
  awaitResult = false,
  waveToken = null
}) => {
  if (!provider || typeof provider.preflight !== 'function') {
    return awaitResult ? Promise.resolve(null) : null;
  }
  const state = resolveState(ctx);
  const log = resolveLogger(ctx);
  const providerId = describeProvider(provider);
  const preflightId = resolvePreflightId(provider);
  const preflightClass = resolveProviderPreflightClass(provider);
  const preflightTimeoutMs = resolvePreflightTimeoutMs({
    ctx,
    provider,
    preflightClass
  });
  const key = resolvePreflightKey({ provider, ctx, inputs });
  const completed = state.completed.get(key);
  const completedReusable = (
    Boolean(waveToken)
    && completed?.waveToken
    && completed.waveToken === waveToken
  );
  if (completed?.status === 'fulfilled' && completedReusable) {
    const snapshot = setSnapshot(state, key, {
      providerId,
      preflightId,
      state: completed?.state || TOOLING_PREFLIGHT_STATES.READY,
      reasonCode: completed?.reasonCode || TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT,
      message: completed?.message || 'reused completed preflight result.',
      startedAtMs: completed?.startedAtMs ?? null,
      finishedAtMs: completed?.finishedAtMs ?? Date.now(),
      durationMs: completed?.durationMs ?? null,
      cached: true,
      timedOut: completed?.timedOut === true,
      preflightClass,
      preflightTimeoutMs
    });
    if (snapshot) {
      log(
        `[tooling] preflight:cache_hit provider=${providerId} id=${preflightId} `
        + `state=${snapshot.state}`
      );
    }
    return Promise.resolve(completed.value ?? null);
  }
  if (completed?.status === 'rejected' && completedReusable) {
    const snapshot = setSnapshot(state, key, {
      providerId,
      preflightId,
      state: TOOLING_PREFLIGHT_STATES.FAILED,
      reasonCode: completed?.reasonCode || TOOLING_PREFLIGHT_REASON_CODES.FAILED,
      message: completed?.message || 'reused completed preflight failure.',
      startedAtMs: completed?.startedAtMs ?? null,
      finishedAtMs: completed?.finishedAtMs ?? Date.now(),
      durationMs: completed?.durationMs ?? null,
      cached: true,
      timedOut: completed?.timedOut === true,
      preflightClass,
      preflightTimeoutMs
    });
    if (snapshot) {
      log(`[tooling] preflight:cache_hit provider=${providerId} id=${preflightId} state=failed`);
    }
    return Promise.reject(completed.error);
  }
  const existing = state.inFlight.get(key);
  if (existing?.promise) {
    return existing.promise;
  }

  const requestedAbortSignal = resolveRequestedAbortSignal(ctx, inputs);
  const managedAbortBridge = createManagedAbortBridge(requestedAbortSignal);
  const preflightInputs = {
    ...(inputs && typeof inputs === 'object' ? inputs : {}),
    abortSignal: managedAbortBridge.signal || requestedAbortSignal || null,
    managerAbortSignal: managedAbortBridge.signal || null,
    preflightClass,
    preflightTimeoutMs
  };

  let resolvePromise = null;
  let rejectPromise = null;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  }).finally(() => {
    managedAbortBridge.cleanup();
    const current = state.inFlight.get(key);
    if (current?.promise === promise) {
      state.inFlight.delete(key);
    }
  });

  const task = {
    key,
    providerId,
    preflightId,
    preflightClass,
    preflightTimeoutMs,
    waveToken,
    resolve: resolvePromise,
    reject: rejectPromise,
    started: false,
    enqueuedAtMs: null,
    settled: false,
    cancelled: false,
    execute: async () => {
      const startedAtMs = Date.now();
      setSnapshot(state, key, {
        providerId,
        preflightId,
        state: TOOLING_PREFLIGHT_STATES.RUNNING,
        reasonCode: null,
        message: '',
        startedAtMs,
        finishedAtMs: null,
        durationMs: null,
        cached: false,
        timedOut: false,
        preflightClass,
        preflightTimeoutMs
      });
      log(
        `[tooling] preflight:start provider=${providerId} id=${preflightId} `
        + `class=${preflightClass} timeoutMs=${preflightTimeoutMs}`
      );
      try {
        const rawResult = await provider.preflight(ctx, preflightInputs);
        const result = normalizeToolingPreflightResult(rawResult);
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        const status = String(result?.state || TOOLING_PREFLIGHT_STATES.READY);
        const timedOut = result?.timedOut === true;
        const reasonCode = result?.reasonCode || null;
        const message = String(result?.message || '');
        const eventName = timedOut
          ? 'timeout'
          : (status === TOOLING_PREFLIGHT_STATES.READY ? 'ok' : status);
        if (timedOut) {
          state.scheduler.metrics.timedOut += 1;
        }
        log(
          `[tooling] preflight:${eventName} provider=${providerId} id=${preflightId} `
          + `durationMs=${elapsedMs} state=${status}${timedOut ? ' timeout=1' : ''}`
        );
        setSnapshot(state, key, {
          providerId,
          preflightId,
          state: status,
          reasonCode,
          message,
          startedAtMs,
          finishedAtMs: Date.now(),
          durationMs: elapsedMs,
          cached: false,
          timedOut,
          preflightClass,
          preflightTimeoutMs
        });
        state.completed.set(key, {
          providerId,
          preflightId,
          waveToken,
          status: 'fulfilled',
          state: status,
          reasonCode,
          message,
          durationMs: elapsedMs,
          startedAtMs,
          finishedAtMs: Date.now(),
          timedOut,
          value: result || null,
          diagnostic: buildToolingPreflightDiagnostic({
            providerId,
            preflightId,
            state: status,
            reasonCode,
            message,
            durationMs: elapsedMs,
            timedOut,
            cached: false,
            startedAtMs,
            finishedAtMs: Date.now()
          })
        });
        return result || null;
      } catch (error) {
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        const message = error?.message || String(error);
        state.scheduler.metrics.failed += 1;
        log(
          `[tooling] preflight:failed provider=${providerId} id=${preflightId} `
          + `durationMs=${elapsedMs} error=${message}`
        );
        setSnapshot(state, key, {
          providerId,
          preflightId,
          state: TOOLING_PREFLIGHT_STATES.FAILED,
          reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
          message,
          startedAtMs,
          finishedAtMs: Date.now(),
          durationMs: elapsedMs,
          cached: false,
          timedOut: false,
          preflightClass,
          preflightTimeoutMs
        });
        state.completed.set(key, {
          providerId,
          preflightId,
          waveToken,
          status: 'rejected',
          state: TOOLING_PREFLIGHT_STATES.FAILED,
          reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
          message,
          durationMs: elapsedMs,
          startedAtMs,
          finishedAtMs: Date.now(),
          timedOut: false,
          error,
          diagnostic: buildToolingPreflightDiagnostic({
            providerId,
            preflightId,
            state: TOOLING_PREFLIGHT_STATES.FAILED,
            reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
            message,
            durationMs: elapsedMs,
            timedOut: false,
            cached: false,
            startedAtMs,
            finishedAtMs: Date.now()
          })
        });
        throw error;
      }
    }
  };

  state.inFlight.set(key, {
    providerId,
    preflightId,
    startedAtMs: null,
    preflightClass,
    preflightTimeoutMs,
    promise,
    abort: (reason) => {
      managedAbortBridge.abort(reason);
      if (task.started || task.settled) return;
      task.cancelled = true;
      const scheduler = resolveScheduler(state, ctx);
      removeQueuedTask(scheduler, task);
      finalizeQueuedTaskAbort({
        state,
        task,
        error: normalizeAbortError(reason)
      });
    }
  });

  scheduleTask({ state, ctx, task });

  if (!awaitResult) {
    promise.catch(() => {});
  }
  return promise;
};

/**
 * Kick off provider preflight tasks for selected plans.
 *
 * Tasks execute in the background and share single-flight state with later
 * provider-time awaits.
 *
 * @param {object} ctx
 * @param {Array<{provider?:object,documents?:Array<object>,targets?:Array<object>}>} providerPlans
 * @returns {void}
 */
export const kickoffToolingProviderPreflights = (ctx, providerPlans) => {
  const plans = Array.isArray(providerPlans) ? providerPlans : [];
  if (!plans.length) return null;
  const waveToken = createWaveToken();
  const seen = new Set();
  for (const plan of plans) {
    const provider = plan?.provider;
    if (!provider || typeof provider.preflight !== 'function') continue;
    const documents = Array.isArray(plan?.documents) ? plan.documents : [];
    const targets = Array.isArray(plan?.targets) ? plan.targets : [];
    if (!documents.length || !targets.length) continue;
    const key = resolvePreflightKey({
      provider,
      ctx,
      inputs: {
        documents,
        targets
      }
    });
    if (seen.has(key)) continue;
    seen.add(key);
    startProviderPreflight({
      ctx,
      provider,
      inputs: {
        documents,
        targets
      },
      awaitResult: false,
      waveToken
    });
  }
  return waveToken;
};

/**
 * Await one provider preflight task.
 *
 * If no task is currently running, this starts one and awaits completion.
 *
 * @param {object} ctx
 * @param {{provider:object,inputs?:object,waveToken?:string|null}} input
 * @returns {Promise<object|null>}
 */
export const awaitToolingProviderPreflight = async (
  ctx,
  { provider, inputs = null, waveToken = null } = {}
) => (
  await startProviderPreflight({
    ctx,
    provider,
    inputs,
    awaitResult: true,
    waveToken
  })
);

/**
 * Read a preflight snapshot without triggering execution.
 *
 * @param {object} ctx
 * @param {{provider:object,inputs?:object}} input
 * @returns {object|null}
 */
export const readToolingProviderPreflightState = (ctx, { provider, inputs = null } = {}) => {
  if (!provider || typeof provider !== 'object') return null;
  const state = resolveState(ctx);
  const key = resolvePreflightKey({ provider, ctx, inputs });
  const snapshot = resolveSnapshotForKey(state, key);
  if (snapshot) return snapshot;
  return {
    providerId: describeProvider(provider),
    preflightId: resolvePreflightId(provider),
    key,
    state: TOOLING_PREFLIGHT_STATES.IDLE,
    reasonCode: null,
    message: '',
    startedAtMs: null,
    finishedAtMs: null,
    durationMs: null,
    cached: false,
    timedOut: false,
    diagnostic: buildToolingPreflightDiagnostic({
      providerId: describeProvider(provider),
      preflightId: resolvePreflightId(provider),
      state: TOOLING_PREFLIGHT_STATES.IDLE,
      reasonCode: TOOLING_PREFLIGHT_REASON_CODES.UNKNOWN,
      message: '',
      durationMs: null,
      timedOut: false,
      cached: false,
      startedAtMs: null,
      finishedAtMs: null
    })
  };
};

/**
 * Return every known preflight snapshot for the current runtime context.
 *
 * @param {object} ctx
 * @returns {Array<object>}
 */
export const listToolingProviderPreflightStates = (ctx) => {
  const state = resolveState(ctx);
  return Array.from(state.snapshots.values())
    .map((entry) => cloneSnapshot(entry))
    .filter(Boolean);
};

/**
 * Return scheduler-level preflight queue metrics for observability.
 *
 * @param {object} ctx
 * @returns {object}
 */
export const getToolingProviderPreflightSchedulerMetrics = (ctx) => {
  const state = resolveState(ctx);
  return buildSchedulerMetricsSnapshot(state, ctx);
};

/**
 * Await in-flight preflight work during runtime closeout with a bounded wait.
 *
 * @param {object} ctx
 * @param {{timeoutMs?:number}} input
 * @returns {Promise<{total:number,settled:number,rejected:number,timedOut:boolean}>}
 */
export const teardownToolingProviderPreflights = async (ctx, { timeoutMs = 5000 } = {}) => {
  const state = resolveState(ctx);
  const scheduler = resolveScheduler(state, ctx);
  scheduler.accepting = false;
  const inFlightEntries = Array.from(state.inFlight.values());
  if (!inFlightEntries.length) {
    return { total: 0, settled: 0, rejected: 0, timedOut: false, aborted: 0 };
  }
  const log = resolveLogger(ctx);
  const promises = inFlightEntries
    .map((entry) => entry?.promise)
    .filter((promise) => promise && typeof promise.then === 'function');
  const waited = await waitForPromisesWithTimeout(promises, timeoutMs);
  if (waited.timedOut) {
    let aborted = 0;
    for (const entry of inFlightEntries) {
      if (typeof entry?.abort !== 'function') continue;
      try {
        entry.abort(new Error('tooling preflight teardown timeout'));
        aborted += 1;
      } catch {}
    }
    if (aborted > 0) {
      log(`[tooling] preflight:teardown_abort active=${aborted}`);
    }
    const settledAfterAbort = await waitForPromisesWithTimeout(promises, 1000);
    const nowMs = Date.now();
    const offenderSummary = inFlightEntries
      .map((entry) => {
        const providerId = String(entry?.providerId || '<unknown>');
        const preflightId = String(entry?.preflightId || '<unknown>');
        const preflightClass = String(entry?.preflightClass || 'unknown');
        const startedAtMs = Number.isFinite(entry?.startedAtMs) ? entry.startedAtMs : null;
        const ageMs = Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : null;
        return `${providerId}/${preflightId}[${preflightClass}]${Number.isFinite(ageMs) ? `:${Math.round(ageMs)}ms` : ''}`;
      })
      .slice(0, 8)
      .join(', ');
    log(
      `[tooling] preflight:teardown_timeout active=${promises.length} timeoutMs=${Math.max(0, Math.floor(timeoutMs))}`
      + ` offenders=${offenderSummary || 'none'}`
    );
    const rejectedAfterAbort = settledAfterAbort.timedOut
      ? 0
      : settledAfterAbort.settled.filter((entry) => entry?.status === 'rejected').length;
    return {
      total: promises.length,
      settled: settledAfterAbort.timedOut ? 0 : settledAfterAbort.settled.length,
      rejected: rejectedAfterAbort,
      timedOut: true,
      aborted
    };
  }
  const rejected = waited.settled.filter((entry) => entry?.status === 'rejected').length;
  return {
    total: promises.length,
    settled: waited.settled.length,
    rejected,
    timedOut: false,
    aborted: 0
  };
};
