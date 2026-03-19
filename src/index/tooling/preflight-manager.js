import {
  withTrackedSubprocessSignalScope
} from '../../shared/subprocess.js';
import {
  createTimeoutError,
  runWithTimeout
} from '../../shared/promise-timeout.js';
import { PREFLIGHT_POLICY } from './provider-contract.js';
import {
  TOOLING_PREFLIGHT_REASON_CODES,
  TOOLING_PREFLIGHT_STATES,
  buildToolingPreflightDiagnostic,
  normalizeToolingPreflightResult
} from './preflight/contract.js';
import {
  PREFLIGHT_CLASS,
  resolvePreflightTimeoutMs,
  resolveProviderPreflightClass,
  resolveProviderPreflightPolicy
} from './preflight/manager-config.js';
import {
  buildSchedulerMetricsSnapshot,
  finalizeQueuedTaskAbort,
  incrementClassMetric,
  isPreflightTimeoutError,
  normalizeAbortError,
  removeQueuedTask,
  resolveScheduler,
  scheduleTask
} from './preflight/manager-scheduler.js';
import {
  createManagedAbortBridge,
  createWaveToken,
  describeProvider,
  resolveLogger,
  resolvePreflightId,
  resolvePreflightKey,
  resolvePreflightOwnershipId,
  resolveRequestedAbortSignal,
  resolveSnapshotForKey,
  resolveState,
  setSnapshot,
  cloneSnapshot
} from './preflight/manager-state.js';
import {
  forceCleanupTrackedPreflightProcesses,
  waitForPromisesWithTimeout
} from './preflight/manager-teardown.js';

const PREFLIGHT_TEARDOWN_SETTLE_TIMEOUT_MS = 1000;

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
  const preflightPolicy = resolveProviderPreflightPolicy(provider);
  const preflightTimeoutMs = resolvePreflightTimeoutMs({
    ctx,
    provider,
    preflightClass
  });
  const key = resolvePreflightKey({ provider, ctx, inputs });
  const ownershipId = resolvePreflightOwnershipId({
    providerId,
    preflightId,
    key
  });
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
      preflightPolicy,
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
      preflightPolicy,
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
  // New execution should not inherit terminal snapshot state from prior runs.
  state.snapshots.delete(key);

  const requestedAbortSignal = resolveRequestedAbortSignal(ctx, inputs);
  const managedAbortBridge = createManagedAbortBridge(requestedAbortSignal);
  const preflightInputs = {
    ...(inputs && typeof inputs === 'object' ? inputs : {}),
    abortSignal: managedAbortBridge.signal || requestedAbortSignal || null,
    managerAbortSignal: managedAbortBridge.signal || null,
    preflightPolicy,
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
    if (managedAbortBridge.signal && managedAbortHandler) {
      managedAbortBridge.signal.removeEventListener('abort', managedAbortHandler);
    }
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
    preflightPolicy,
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
      const inFlightEntry = state.inFlight.get(key);
      if (inFlightEntry && typeof inFlightEntry === 'object') {
        inFlightEntry.startedAtMs = startedAtMs;
      }
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
        preflightPolicy,
        preflightClass,
        preflightTimeoutMs
      });
      log(
        `[tooling] preflight:start provider=${providerId} id=${preflightId} `
        + `class=${preflightClass} timeoutMs=${preflightTimeoutMs}`
      );
      try {
        const rawResult = await runWithTimeout(
          async (timeoutSignal) => {
            const effectiveSignal = timeoutSignal || managedAbortBridge.signal || requestedAbortSignal || null;
            return withTrackedSubprocessSignalScope(
              effectiveSignal,
              ownershipId,
              () => provider.preflight(
                ctx,
                {
                  ...preflightInputs,
                  abortSignal: effectiveSignal,
                  managerAbortSignal: effectiveSignal
                }
              )
            );
          },
          {
            timeoutMs: preflightTimeoutMs,
            signal: managedAbortBridge.signal || requestedAbortSignal || null,
            errorFactory: () => createTimeoutError({
              message: `Tooling preflight timed out after ${preflightTimeoutMs}ms (${providerId}/${preflightId}).`,
              code: 'TOOLING_PREFLIGHT_TIMEOUT',
              retryable: false,
              meta: {
                providerId,
                preflightId,
                preflightClass,
                timeoutMs: preflightTimeoutMs
              }
            })
          }
        );
        const result = normalizeToolingPreflightResult(rawResult);
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        const status = String(result?.state || TOOLING_PREFLIGHT_STATES.READY);
        const timedOut = result?.timedOut === true;
        const cached = result?.cached === true;
        const reasonCode = result?.reasonCode || null;
        const message = String(result?.message || '');
        const eventName = cached
          ? 'cache_hit'
          : (timedOut
            ? 'timeout'
            : (status === TOOLING_PREFLIGHT_STATES.READY ? 'ok' : status));
        if (timedOut) {
          state.scheduler.metrics.timedOut += 1;
          incrementClassMetric(state.scheduler.metrics, preflightClass, 'timedOut');
        }
        log(
          `[tooling] preflight:${eventName} provider=${providerId} id=${preflightId} `
          + `durationMs=${elapsedMs} state=${status}`
          + `${timedOut ? ' timeout=1' : ''}`
          + `${cached ? ' cached=1' : ''}`
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
          cached,
          timedOut,
          preflightPolicy,
          preflightClass,
          preflightTimeoutMs
        });
        state.completed.set(key, {
          providerId,
          preflightId,
          preflightPolicy,
          waveToken,
          status: 'fulfilled',
          state: status,
          reasonCode,
          message,
          durationMs: elapsedMs,
          startedAtMs,
          finishedAtMs: Date.now(),
          timedOut,
          cached,
          value: result || null,
          diagnostic: buildToolingPreflightDiagnostic({
            providerId,
            preflightId,
            state: status,
            reasonCode,
            message,
            durationMs: elapsedMs,
            timedOut,
            cached,
            startedAtMs,
            finishedAtMs: Date.now()
          })
        });
        return result || null;
      } catch (error) {
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        const timedOut = isPreflightTimeoutError(error);
        const message = timedOut
          ? `preflight timed out after ${preflightTimeoutMs}ms`
          : (error?.message || String(error));
        if (timedOut) {
          state.scheduler.metrics.timedOut += 1;
          incrementClassMetric(state.scheduler.metrics, preflightClass, 'timedOut');
        } else {
          state.scheduler.metrics.failed += 1;
          incrementClassMetric(state.scheduler.metrics, preflightClass, 'failed');
        }
        const failOpen = preflightPolicy === PREFLIGHT_POLICY.OPTIONAL;
        const failOpenState = TOOLING_PREFLIGHT_STATES.DEGRADED;
        const finalState = failOpen ? failOpenState : TOOLING_PREFLIGHT_STATES.FAILED;
        const finalReasonCode = timedOut
          ? TOOLING_PREFLIGHT_REASON_CODES.TIMEOUT
          : TOOLING_PREFLIGHT_REASON_CODES.FAILED;
        const finalMessage = failOpen
          ? `optional preflight failed open: ${message}`
          : message;
        log(
          `[tooling] preflight:${timedOut ? 'timeout' : (failOpen ? 'degraded' : 'failed')} provider=${providerId} id=${preflightId} `
          + `durationMs=${elapsedMs}${failOpen ? ' failOpen=1' : ''} error=${message}`
        );
        setSnapshot(state, key, {
          providerId,
          preflightId,
          state: finalState,
          reasonCode: finalReasonCode,
          message: finalMessage,
          startedAtMs,
          finishedAtMs: Date.now(),
          durationMs: elapsedMs,
          cached: false,
          timedOut,
          preflightPolicy,
          preflightClass,
          preflightTimeoutMs
        });
        if (failOpen) {
          const value = {
            state: failOpenState,
            reasonCode: finalReasonCode,
            message: finalMessage,
            blockProvider: false,
            checks: [{
              name: `${providerId}_preflight_failed_open`,
              status: 'warn',
              message: finalMessage
            }]
          };
          state.completed.set(key, {
            providerId,
            preflightId,
            preflightPolicy,
            waveToken,
            status: 'fulfilled',
            state: failOpenState,
            reasonCode: finalReasonCode,
            message: finalMessage,
            durationMs: elapsedMs,
            startedAtMs,
            finishedAtMs: Date.now(),
            timedOut,
            value,
            diagnostic: buildToolingPreflightDiagnostic({
              providerId,
              preflightId,
              state: failOpenState,
              reasonCode: finalReasonCode,
              message: finalMessage,
              durationMs: elapsedMs,
              timedOut,
              cached: false,
              startedAtMs,
              finishedAtMs: Date.now()
            })
          });
          return value;
        }
        state.completed.set(key, {
          providerId,
          preflightId,
          preflightPolicy,
          waveToken,
          status: 'rejected',
          state: TOOLING_PREFLIGHT_STATES.FAILED,
          reasonCode: finalReasonCode,
          message: finalMessage,
          durationMs: elapsedMs,
          startedAtMs,
          finishedAtMs: Date.now(),
          timedOut,
          error,
          diagnostic: buildToolingPreflightDiagnostic({
            providerId,
            preflightId,
            state: TOOLING_PREFLIGHT_STATES.FAILED,
            reasonCode: finalReasonCode,
            message: finalMessage,
            durationMs: elapsedMs,
            timedOut,
            cached: false,
            startedAtMs,
            finishedAtMs: Date.now()
          })
        });
        throw error;
      }
    }
  };

  const cancelQueuedTask = (reason) => {
    managedAbortBridge.abort(reason);
    if (task.started || task.settled || task.cancelled === true) return;
    task.cancelled = true;
    const scheduler = resolveScheduler(state, ctx);
    removeQueuedTask(scheduler, task);
    finalizeQueuedTaskAbort({
      state,
      task,
      error: normalizeAbortError(reason)
    });
  };

  let managedAbortHandler = null;
  if (managedAbortBridge.signal && typeof managedAbortBridge.signal.addEventListener === 'function') {
    managedAbortHandler = () => {
      cancelQueuedTask(managedAbortBridge.signal?.reason || new Error('tooling preflight aborted'));
    };
    if (managedAbortBridge.signal.aborted) {
      managedAbortHandler();
    } else {
      managedAbortBridge.signal.addEventListener('abort', managedAbortHandler, { once: true });
    }
  }

  state.inFlight.set(key, {
    providerId,
    preflightId,
    ownershipId,
    startedAtMs: null,
    preflightClass,
    preflightPolicy,
    preflightTimeoutMs,
    promise,
    abort: (reason) => {
      cancelQueuedTask(reason);
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
 * @returns {Promise<{
 *   status:'ok'|'timed_out'|'failed',
 *   total:number,
 *   settled:number,
 *   rejected:number,
 *   timedOut:boolean,
 *   aborted:number,
 *   forcedCleanup?:{
 *     ownershipIds:number,
 *     attempted:number,
 *     terminated:number,
 *     failures:number
 *   },
 *   error?:string
 * }>}
 */
export const teardownToolingProviderPreflights = async (ctx, { timeoutMs = 5000 } = {}) => {
  const log = resolveLogger(ctx);
  try {
    const state = resolveState(ctx);
    const scheduler = resolveScheduler(state, ctx);
    scheduler.accepting = false;
    const inFlightEntries = Array.from(state.inFlight.entries());
    if (!inFlightEntries.length) {
      return { status: 'ok', total: 0, settled: 0, rejected: 0, timedOut: false, aborted: 0 };
    }
    const promises = inFlightEntries
      .map(([, entry]) => entry?.promise)
      .filter((promise) => promise && typeof promise.then === 'function');
    const waited = await waitForPromisesWithTimeout(promises, timeoutMs);
    if (waited.timedOut) {
      let aborted = 0;
      for (const [, entry] of inFlightEntries) {
        if (typeof entry?.abort !== 'function') continue;
        try {
          entry.abort(new Error('tooling preflight teardown timeout'));
          aborted += 1;
        } catch {}
      }
      if (aborted > 0) {
        log(`[tooling] preflight:teardown_abort active=${aborted}`);
      }
      const forcedCleanup = await forceCleanupTrackedPreflightProcesses({ inFlightEntries, log });
      const settledAfterAbort = await waitForPromisesWithTimeout(promises, 1000);
      for (const [entryKey, entry] of inFlightEntries) {
        const entryPromise = entry?.promise;
        if (!entryKey || !entryPromise) continue;
        if (state.inFlight.get(entryKey)?.promise !== entryPromise) continue;
        const providerId = String(entry?.providerId || '<unknown>');
        const preflightId = String(entry?.preflightId || '<unknown>');
        const preflightClass = String(entry?.preflightClass || PREFLIGHT_CLASS.PROBE);
        const preflightPolicy = entry?.preflightPolicy || PREFLIGHT_POLICY.REQUIRED;
        const startedAtMs = Number.isFinite(entry?.startedAtMs) ? entry.startedAtMs : null;
        const finishedAtMs = Date.now();
        const durationMs = Number.isFinite(startedAtMs)
          ? Math.max(0, finishedAtMs - startedAtMs)
          : Math.max(0, Math.floor(timeoutMs));
        const timeoutMessage = `preflight teardown timed out after ${Math.max(0, Math.floor(timeoutMs))}ms`;
        setSnapshot(state, entryKey, {
          providerId,
          preflightId,
          state: TOOLING_PREFLIGHT_STATES.FAILED,
          reasonCode: TOOLING_PREFLIGHT_REASON_CODES.TIMEOUT,
          message: timeoutMessage,
          startedAtMs,
          finishedAtMs,
          durationMs,
          cached: false,
          timedOut: true,
          preflightPolicy,
          preflightClass,
          preflightTimeoutMs: Number.isFinite(entry?.preflightTimeoutMs)
            ? Math.max(0, Math.floor(Number(entry.preflightTimeoutMs)))
            : null
        });
        const timeoutError = createTimeoutError({
          message: timeoutMessage,
          code: 'TOOLING_PREFLIGHT_TEARDOWN_TIMEOUT',
          retryable: false,
          meta: {
            providerId,
            preflightId
          }
        });
        state.completed.set(entryKey, {
          providerId,
          preflightId,
          preflightPolicy,
          waveToken: entry?.waveToken || null,
          status: 'rejected',
          state: TOOLING_PREFLIGHT_STATES.FAILED,
          reasonCode: TOOLING_PREFLIGHT_REASON_CODES.TIMEOUT,
          message: timeoutMessage,
          durationMs,
          startedAtMs,
          finishedAtMs,
          timedOut: true,
          error: timeoutError,
          diagnostic: buildToolingPreflightDiagnostic({
            providerId,
            preflightId,
            state: TOOLING_PREFLIGHT_STATES.FAILED,
            reasonCode: TOOLING_PREFLIGHT_REASON_CODES.TIMEOUT,
            message: timeoutMessage,
            durationMs,
            timedOut: true,
            cached: false,
            startedAtMs,
            finishedAtMs
          })
        });
        /**
         * Keep in-flight entry until the original promise settles so its own
         * finally-handler can complete normal cleanup and cancellation paths.
         */
      }
      const nowMs = Date.now();
      const offenderSummary = inFlightEntries
        .map(([, entry]) => {
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
      if (!settledAfterAbort.timedOut && settledAfterAbort.settled.length > 0) {
        await waitForPromisesWithTimeout(promises, PREFLIGHT_TEARDOWN_SETTLE_TIMEOUT_MS);
      }
      return {
        status: 'timed_out',
        total: promises.length,
        settled: settledAfterAbort.timedOut ? 0 : settledAfterAbort.settled.length,
        rejected: rejectedAfterAbort,
        timedOut: true,
        aborted,
        forcedCleanup
      };
    }
    const rejected = waited.settled.filter((entry) => entry?.status === 'rejected').length;
    return {
      status: 'ok',
      total: promises.length,
      settled: waited.settled.length,
      rejected,
      timedOut: false,
      aborted: 0
    };
  } catch (error) {
    log(`[tooling] preflight:teardown_failed error=${error?.message || error}`);
    return {
      status: 'failed',
      total: 0,
      settled: 0,
      rejected: 0,
      timedOut: false,
      aborted: 0,
      error: error?.message || String(error)
    };
  }
};
