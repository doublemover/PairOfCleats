import {
  TOOLING_PREFLIGHT_REASON_CODES,
  TOOLING_PREFLIGHT_STATES,
  buildToolingPreflightDiagnostic
} from './contract.js';
import {
  PREFLIGHT_CLASS,
  normalizePreflightClass,
  resolveSchedulerConfig
} from './manager-config.js';
import {
  resolveLogger,
  setSnapshot
} from './manager-state.js';

export const resolveScheduler = (state, ctx) => {
  const scheduler = state.scheduler;
  const config = resolveSchedulerConfig(ctx);
  scheduler.maxConcurrency = config.maxConcurrency;
  if (!scheduler.accepting && state.inFlight.size === 0 && scheduler.queue.length === 0) {
    scheduler.accepting = true;
  }
  return scheduler;
};

export const buildSchedulerMetricsSnapshot = (state, ctx) => {
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
    failed: metrics.failed,
    byClass: {
      [PREFLIGHT_CLASS.PROBE]: { ...(metrics.byClass?.[PREFLIGHT_CLASS.PROBE] || {}) },
      [PREFLIGHT_CLASS.WORKSPACE]: { ...(metrics.byClass?.[PREFLIGHT_CLASS.WORKSPACE] || {}) },
      [PREFLIGHT_CLASS.DEPENDENCY]: { ...(metrics.byClass?.[PREFLIGHT_CLASS.DEPENDENCY] || {}) }
    }
  };
};

export const incrementClassMetric = (metrics, preflightClass, field) => {
  const className = normalizePreflightClass(preflightClass, PREFLIGHT_CLASS.PROBE);
  const bucket = metrics?.byClass?.[className];
  if (!bucket || typeof bucket !== 'object') return;
  bucket[field] = (Number(bucket[field]) || 0) + 1;
};

export const createSchedulerClosedError = () => {
  const error = new Error('tooling preflight scheduler is closed');
  error.code = 'TOOLING_PREFLIGHT_SCHEDULER_CLOSED';
  return error;
};

export const normalizeAbortError = (reason) => {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string' && reason.trim()) return new Error(reason.trim());
  return new Error('tooling preflight aborted');
};

export const isPreflightTimeoutError = (error) => {
  const code = String(error?.code || '').trim();
  return code === 'TOOLING_PREFLIGHT_TIMEOUT' || code === 'ERR_TIMEOUT';
};

export const removeQueuedTask = (scheduler, task) => {
  const index = scheduler.queue.indexOf(task);
  if (index < 0) return false;
  scheduler.queue.splice(index, 1);
  return true;
};

export const finalizeQueuedTaskAbort = ({ state, task, error }) => {
  if (task.settled) return;
  task.settled = true;
  const finishedAtMs = Date.now();
  setSnapshot(state, task.key, {
    providerId: task.providerId,
    preflightId: task.preflightId,
    state: TOOLING_PREFLIGHT_STATES.FAILED,
    reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
    message: error?.message || 'preflight aborted before execution.',
    startedAtMs: null,
    finishedAtMs,
    durationMs: 0,
    cached: false,
    timedOut: false,
    preflightPolicy: task.preflightPolicy,
    preflightClass: task.preflightClass,
    preflightTimeoutMs: task.preflightTimeoutMs
  });
  state.completed.set(task.key, {
    providerId: task.providerId,
    preflightId: task.preflightId,
    preflightPolicy: task.preflightPolicy,
    waveToken: task.waveToken,
    status: 'rejected',
    state: TOOLING_PREFLIGHT_STATES.FAILED,
    reasonCode: TOOLING_PREFLIGHT_REASON_CODES.FAILED,
    message: error?.message || 'preflight aborted before execution.',
    durationMs: 0,
    startedAtMs: null,
    finishedAtMs,
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
      finishedAtMs
    })
  });
  task.reject(error);
};

export const runScheduledTask = ({ state, ctx, task, fromQueue = false }) => {
  const scheduler = resolveScheduler(state, ctx);
  const log = resolveLogger(ctx);
  scheduler.running += 1;
  scheduler.metrics.started += 1;
  incrementClassMetric(scheduler.metrics, task.preflightClass, 'started');
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
      incrementClassMetric(scheduler.metrics, task.preflightClass, 'completed');
      while (scheduler.running < scheduler.maxConcurrency && scheduler.queue.length > 0) {
        const nextTask = scheduler.queue.shift();
        if (!nextTask || nextTask.cancelled === true || nextTask.settled) continue;
        scheduler.metrics.dequeued += 1;
        incrementClassMetric(scheduler.metrics, nextTask.preflightClass, 'dequeued');
        runScheduledTask({ state, ctx, task: nextTask, fromQueue: true });
      }
    });
};

export const scheduleTask = ({ state, ctx, task }) => {
  const scheduler = resolveScheduler(state, ctx);
  const log = resolveLogger(ctx);
  scheduler.metrics.scheduled += 1;
  incrementClassMetric(scheduler.metrics, task.preflightClass, 'scheduled');

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
  incrementClassMetric(scheduler.metrics, task.preflightClass, 'queued');
  scheduler.metrics.queueDepthPeak = Math.max(scheduler.metrics.queueDepthPeak, scheduler.queue.length);
  log(
    `[tooling] preflight:queued provider=${task.providerId} id=${task.preflightId} `
    + `class=${task.preflightClass} depth=${scheduler.queue.length} running=${scheduler.running} cap=${scheduler.maxConcurrency}`
  );
};
