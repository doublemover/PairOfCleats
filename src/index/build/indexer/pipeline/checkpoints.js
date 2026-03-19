import os from 'node:os';
import { log, logLine } from '../../../../shared/progress.js';
import { coerceUnitFraction } from '../../../../shared/number-coerce.js';
import { runWithHangProbe } from '../hang-probe.js';

const STATE_WRITE_TIMEOUT_WARNING_DEFAULT_MS = 10000;
const STATE_WRITE_CONTINUE_DEFAULT_MS = 5000;
const CHECKPOINT_VOLATILE_QUEUE_FIELDS = new Set([
  'oldestWaitMs',
  'lastWaitMs',
  'waitP95Ms',
  'waitSampleCount'
]);

export const sanitizeRuntimeSnapshotForCheckpoint = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const sanitized = { ...snapshot };
  const scheduler = snapshot.scheduler && typeof snapshot.scheduler === 'object'
    ? { ...snapshot.scheduler }
    : null;
  if (scheduler && scheduler.queues && typeof scheduler.queues === 'object') {
    const queues = {};
    for (const [queueName, queueStats] of Object.entries(scheduler.queues)) {
      if (!queueStats || typeof queueStats !== 'object') {
        queues[queueName] = queueStats;
        continue;
      }
      const sanitizedQueue = { ...queueStats };
      for (const field of CHECKPOINT_VOLATILE_QUEUE_FIELDS) {
        delete sanitizedQueue[field];
      }
      queues[queueName] = sanitizedQueue;
    }
    scheduler.queues = queues;
  }
  if (scheduler) {
    sanitized.scheduler = scheduler;
  }
  return sanitized;
};

export const createPipelineCheckpointController = ({
  mode,
  runtime,
  stageCheckpoints,
  hangProbeConfig = null,
  hostCpuCount = Array.isArray(os.cpus()) ? os.cpus().length : null,
  heavyUtilizationStages = [],
  logFn = log,
  logLineFn = logLine
} = {}) => {
  const getSchedulerStats = () => (runtime?.scheduler?.stats ? runtime.scheduler.stats() : null);
  const schedulerTelemetry = runtime?.scheduler
  && typeof runtime.scheduler.setTelemetryOptions === 'function'
    ? runtime.scheduler
    : null;
  const queueDepthSnapshotIntervalMs = Number.isFinite(
    Number(runtime?.indexingConfig?.scheduler?.queueDepthSnapshotIntervalMs)
  )
    ? Math.max(1000, Math.floor(Number(runtime.indexingConfig.scheduler.queueDepthSnapshotIntervalMs)))
    : 5000;
  const queueDepthSnapshotFileThreshold = Number.isFinite(
    Number(runtime?.indexingConfig?.scheduler?.queueDepthSnapshotFileThreshold)
  )
    ? Math.max(1, Math.floor(Number(runtime.indexingConfig.scheduler.queueDepthSnapshotFileThreshold)))
    : 20000;
  let queueDepthSnapshotsEnabled = false;
  const setSchedulerTelemetryStage = (stageId) => {
    if (!schedulerTelemetry || typeof stageId !== 'string') return;
    schedulerTelemetry.setTelemetryOptions({ stage: stageId });
  };
  const enableQueueDepthSnapshots = () => {
    if (!schedulerTelemetry || queueDepthSnapshotsEnabled) return;
    queueDepthSnapshotsEnabled = true;
    schedulerTelemetry.setTelemetryOptions({
      queueDepthSnapshotsEnabled: true,
      queueDepthSnapshotIntervalMs
    });
  };
  if (runtime?.hugeRepoProfileEnabled === true) {
    enableQueueDepthSnapshots();
  }

  const heavyUtilizationStagesSet = new Set(
    (Array.isArray(heavyUtilizationStages) ? heavyUtilizationStages : [])
      .map((entry) => String(entry || '').toLowerCase())
      .filter(Boolean)
  );
  const stateWriteWarnMs = Math.max(
    STATE_WRITE_TIMEOUT_WARNING_DEFAULT_MS,
    Number.isFinite(Number(hangProbeConfig?.warnMs))
      ? Math.floor(Number(hangProbeConfig.warnMs))
      : STATE_WRITE_TIMEOUT_WARNING_DEFAULT_MS
  );
  const stateWriteContinueMs = Number.isFinite(Number(runtime?.indexingConfig?.stateWriteContinueMs))
    ? Math.max(500, Math.floor(Number(runtime.indexingConfig.stateWriteContinueMs)))
    : STATE_WRITE_CONTINUE_DEFAULT_MS;

  let lowUtilizationWarningEmitted = false;
  const utilizationTarget = coerceUnitFraction(runtime?.schedulerConfig?.utilizationAlertTarget)
  ?? 0.75;
  const utilizationAlertWindowMs = Number.isFinite(Number(runtime?.schedulerConfig?.utilizationAlertWindowMs))
    ? Math.max(1000, Math.floor(Number(runtime.schedulerConfig.utilizationAlertWindowMs)))
    : 15000;
  let utilizationUnderTargetSinceMs = 0;
  let utilizationTargetWarningEmitted = false;
  const queueUtilizationUnderTargetSinceMs = new Map();
  const queueUtilizationWarningEmitted = new Set();
  let lastCpuUsage = process.cpuUsage();
  let lastCpuUsageAtMs = Date.now();

  const resolveProcessBusyPct = (cpuCount) => {
    const usage = process.cpuUsage();
    const nowMs = Date.now();
    const elapsedMs = Math.max(1, nowMs - lastCpuUsageAtMs);
    const previous = lastCpuUsage;
    lastCpuUsage = usage;
    lastCpuUsageAtMs = nowMs;
    if (!previous || !Number.isFinite(cpuCount) || cpuCount <= 0) return null;
    const userDeltaUs = Math.max(0, Number(usage.user) - Number(previous.user));
    const systemDeltaUs = Math.max(0, Number(usage.system) - Number(previous.system));
    const consumedMs = (userDeltaUs + systemDeltaUs) / 1000;
    const capacityMs = elapsedMs * cpuCount;
    if (!Number.isFinite(consumedMs) || !Number.isFinite(capacityMs) || capacityMs <= 0) return null;
    return Math.max(0, Math.min(100, (consumedMs / capacityMs) * 100));
  };

  const captureRuntimeSnapshot = () => {
    const schedulerStats = getSchedulerStats();
    const schedulerQueueDepth = schedulerStats?.queues
      ? Object.values(schedulerStats.queues).reduce((sum, queue) => (
        sum + (Number.isFinite(Number(queue?.pending)) ? Number(queue.pending) : 0)
      ), 0)
      : null;
    const queueInflightBytes = runtime?.queues
      ? {
        io: Number(runtime.queues.io?.inflightBytes) || 0,
        cpu: Number(runtime.queues.cpu?.inflightBytes) || 0,
        embedding: Number(runtime.queues.embedding?.inflightBytes) || 0,
        proc: Number(runtime.queues.proc?.inflightBytes) || 0
      }
      : null;
    const telemetryInflightBytes = runtime?.telemetry?.readInFlightBytes
      ? runtime.telemetry.readInFlightBytes()
      : null;
    const workerStats = runtime?.workerPool?.stats ? runtime.workerPool.stats() : null;
    const quantizeWorkerStats = runtime?.quantizePool
    && runtime.quantizePool !== runtime.workerPool
    && runtime.quantizePool?.stats
      ? runtime.quantizePool.stats()
      : null;
    const cpuCount = Array.isArray(runtime?.cpuList) && runtime.cpuList.length
      ? runtime.cpuList.length
      : hostCpuCount;
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const oneMinuteLoad = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) ? loadAvg[0] : null;
    const normalizedCpuLoad = Number.isFinite(oneMinuteLoad) && Number.isFinite(cpuCount) && cpuCount > 0
      ? Math.max(0, Math.min(1, oneMinuteLoad / cpuCount))
      : null;
    const processBusyPct = resolveProcessBusyPct(cpuCount);
    const resolvedBusyPct = Number.isFinite(normalizedCpuLoad)
      ? Math.max(0, Math.min(100, Math.round(normalizedCpuLoad * 1000) / 10))
      : (Number.isFinite(processBusyPct)
        ? Math.max(0, Math.min(100, Math.round(processBusyPct * 10) / 10))
        : null);
    const totalMem = Number(os.totalmem()) || 0;
    const freeMem = Number(os.freemem()) || 0;
    const memoryUtilization = totalMem > 0
      ? Math.max(0, Math.min(1, (totalMem - freeMem) / totalMem))
      : null;
    return {
      scheduler: schedulerStats,
      cpu: {
        cores: Number.isFinite(cpuCount) ? cpuCount : null,
        loadAvg1m: oneMinuteLoad,
        normalizedLoad: normalizedCpuLoad,
        busyPct: resolvedBusyPct
      },
      memory: {
        totalBytes: totalMem > 0 ? totalMem : null,
        freeBytes: freeMem > 0 ? freeMem : null,
        utilization: memoryUtilization
      },
      queues: runtime?.queues
        ? {
          ioPending: Number.isFinite(runtime.queues.io?.size) ? runtime.queues.io.size : null,
          cpuPending: Number.isFinite(runtime.queues.cpu?.size) ? runtime.queues.cpu.size : null,
          embeddingPending: Number.isFinite(runtime.queues.embedding?.size) ? runtime.queues.embedding.size : null,
          procPending: Number.isFinite(runtime.queues.proc?.size) ? runtime.queues.proc.size : null,
          schedulerPending: schedulerQueueDepth
        }
        : null,
      inFlightBytes: {
        queue: queueInflightBytes,
        telemetry: telemetryInflightBytes,
        total: Number(
          (queueInflightBytes?.io || 0)
        + (queueInflightBytes?.cpu || 0)
        + (queueInflightBytes?.embedding || 0)
        + (queueInflightBytes?.proc || 0)
        + (telemetryInflightBytes?.total || 0)
        ) || 0
      },
      workers: {
        tokenize: workerStats || null,
        quantize: quantizeWorkerStats || null
      }
    };
  };

  const maybeWarnLowSchedulerUtilization = ({ snapshot, stage, step }) => {
    if (lowUtilizationWarningEmitted) return;
    const schedulerStats = snapshot?.scheduler;
    const utilization = Number(schedulerStats?.utilization?.overall);
    const pending = Number(schedulerStats?.activity?.pending);
    const cpuTokens = Number(schedulerStats?.tokens?.cpu?.total);
    const ioTokens = Number(schedulerStats?.tokens?.io?.total);
    const tokenBudget = Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)));
    if (!Number.isFinite(utilization) || !Number.isFinite(pending)) return;
    if (pending < Math.max(64, tokenBudget * 4)) return;
    if (utilization >= 0.35) return;
    lowUtilizationWarningEmitted = true;
    logFn(
      `[perf] scheduler under-utilization detected at ${stage}${step ? `/${step}` : ''}: `
      + `utilization=${utilization.toFixed(2)}, pending=${Math.floor(pending)}, `
      + `tokens(cpu=${Math.floor(cpuTokens || 0)}, io=${Math.floor(ioTokens || 0)}).`
    );
  };

  const maybeWarnUtilizationTarget = ({ snapshot, stage, step }) => {
    if (!heavyUtilizationStagesSet.has(String(step || stage || '').toLowerCase())) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const schedulerStats = snapshot?.scheduler;
    const utilization = Number(schedulerStats?.utilization?.overall);
    const pending = Number(schedulerStats?.activity?.pending);
    const cpuTokens = Number(schedulerStats?.tokens?.cpu?.total);
    const ioTokens = Number(schedulerStats?.tokens?.io?.total);
    const tokenBudget = Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)));
    if (!Number.isFinite(utilization) || !Number.isFinite(pending)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (pending < Math.max(16, tokenBudget * 2)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (utilization >= utilizationTarget) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const now = Date.now();
    if (!utilizationUnderTargetSinceMs) {
      utilizationUnderTargetSinceMs = now;
      return;
    }
    if (utilizationTargetWarningEmitted) return;
    const underMs = now - utilizationUnderTargetSinceMs;
    if (underMs < utilizationAlertWindowMs) return;
    utilizationTargetWarningEmitted = true;
    logFn(
      `[perf] sustained scheduler utilization below target at ${stage}${step ? `/${step}` : ''}: `
      + `utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, `
      + `pending=${Math.floor(pending)}, duration=${Math.max(1, Math.round(underMs / 1000))}s.`
    );
    stageCheckpoints.record({
      stage: 'scheduler',
      step: 'utilization-target-breach',
      label: `${stage}${step ? `/${step}` : ''}`,
      extra: {
        utilization,
        target: utilizationTarget,
        pending: Math.floor(pending),
        durationMs: underMs
      }
    });
  };

  const maybeWarnQueueUtilizationTarget = ({ snapshot, stage, step }) => {
    const schedulerStats = snapshot?.scheduler;
    const queues = schedulerStats?.queues && typeof schedulerStats.queues === 'object'
      ? schedulerStats.queues
      : null;
    if (!queues) return;
    const now = Date.now();
    for (const [queueName, queueStats] of Object.entries(queues)) {
      const pending = Math.max(0, Number(queueStats?.pending) || 0);
      const running = Math.max(0, Number(queueStats?.running) || 0);
      const demand = pending + running;
      const key = String(queueName || '');
      const warningKey = `${stage || 'unknown'}:${key}`;
      if (!key || demand < 4) {
        queueUtilizationUnderTargetSinceMs.delete(key);
        queueUtilizationWarningEmitted.delete(warningKey);
        continue;
      }
      const utilization = running / Math.max(1, demand);
      if (!Number.isFinite(utilization) || utilization >= utilizationTarget) {
        queueUtilizationUnderTargetSinceMs.delete(key);
        queueUtilizationWarningEmitted.delete(warningKey);
        continue;
      }
      const since = queueUtilizationUnderTargetSinceMs.get(key) || now;
      queueUtilizationUnderTargetSinceMs.set(key, since);
      const underMs = now - since;
      if (underMs < utilizationAlertWindowMs) continue;
      if (queueUtilizationWarningEmitted.has(warningKey)) continue;
      queueUtilizationWarningEmitted.add(warningKey);
      logFn(
        `[perf] sustained queue utilization below target at ${stage}${step ? `/${step}` : ''}: `
        + `queue=${key}, utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, `
        + `pending=${pending}, running=${running}, durationMs=${underMs}.`
      );
      stageCheckpoints.record({
        stage: 'scheduler',
        step: 'queue-utilization-target-breach',
        label: `${stage}${step ? `/${step}` : ''}:${key}`,
        extra: {
          queue: key,
          utilization,
          target: utilizationTarget,
          pending,
          running,
          durationMs: underMs
        }
      });
    }
  };

  const recordStageCheckpoint = ({
    stage,
    step = null,
    label = null,
    extra = null
  }) => {
    const safeExtra = extra && typeof extra === 'object' ? extra : {};
    const runtimeSnapshot = captureRuntimeSnapshot();
    const sanitizedRuntimeSnapshot = sanitizeRuntimeSnapshotForCheckpoint(runtimeSnapshot);
    stageCheckpoints.record({
      stage,
      step,
      label,
      extra: {
        ...safeExtra,
        runtime: sanitizedRuntimeSnapshot
      }
    });
    maybeWarnLowSchedulerUtilization({ snapshot: runtimeSnapshot, stage, step });
    maybeWarnUtilizationTarget({ snapshot: runtimeSnapshot, stage, step });
    maybeWarnQueueUtilizationTarget({ snapshot: runtimeSnapshot, stage, step });
  };

  const runStateWriteProbe = async ({
    label,
    stage = 'processing',
    step = 'state-write',
    meta = null,
    run
  }) => {
    if (hangProbeConfig?.enabled !== true) {
      return run();
    }
    let timeoutWarnTimer = null;
    let timeoutWarned = false;
    const startedAtMs = Date.now();
    const safeMeta = meta && typeof meta === 'object' ? meta : null;
    return runWithHangProbe({
      ...hangProbeConfig,
      warnMs: stateWriteWarnMs,
      label,
      mode,
      stage,
      step,
      log: logLineFn,
      meta: safeMeta,
      run: async () => {
        timeoutWarnTimer = setTimeout(() => {
          timeoutWarned = true;
          const elapsedMs = Math.max(0, Date.now() - startedAtMs);
          logLineFn(
            `[hang-probe] timeout-warning ${label} exceeded ${stateWriteWarnMs}ms (elapsed=${elapsedMs}ms).`,
            {
              kind: 'warning',
              mode,
              stage,
              step,
              ...(safeMeta || {}),
              hangProbe: {
                event: 'timeout-warning',
                label,
                elapsedMs,
                warnMs: stateWriteWarnMs
              }
            }
          );
        }, stateWriteWarnMs);
        try {
          return await run();
        } finally {
          if (timeoutWarnTimer) clearTimeout(timeoutWarnTimer);
          if (timeoutWarned) {
            const elapsedMs = Math.max(0, Date.now() - startedAtMs);
            logLineFn(
              `[hang-probe] timeout-warning cleared ${label} completed after ${elapsedMs}ms.`,
              {
                kind: 'warning',
                mode,
                stage,
                step,
                ...(safeMeta || {}),
                hangProbe: {
                  event: 'timeout-warning-cleared',
                  label,
                  elapsedMs,
                  warnMs: stateWriteWarnMs
                }
              }
            );
          }
        }
      }
    });
  };

  const runStateWriteBestEffort = async ({
    label,
    stage = 'processing',
    step = 'state-write',
    meta = null,
    run
  }) => {
    const startedAtMs = Date.now();
    const safeMeta = meta && typeof meta === 'object' ? meta : null;
    const stateWritePromise = runStateWriteProbe({
      label,
      stage,
      step,
      meta: safeMeta,
      run
    }).then(
      (value) => ({ status: 'resolved', value }),
      (error) => (error?.code === 'ERR_BUILD_STATE_PATCH_TIMEOUT'
        ? { status: 'timed-out', error }
        : { status: 'rejected', error })
    );
    if (!Number.isFinite(stateWriteContinueMs) || stateWriteContinueMs <= 0) {
      const settled = await stateWritePromise;
      if (settled.status === 'rejected') throw settled.error;
      return settled.value;
    }
    let timeoutHandle = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({ status: 'timed-out' });
      }, stateWriteContinueMs);
    });
    const settled = await Promise.race([stateWritePromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (settled?.status === 'resolved') {
      return settled.value;
    }
    if (settled?.status === 'rejected') {
      throw settled.error;
    }
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    logLineFn(
      `[hang-probe] continuing after ${label} exceeded ${stateWriteContinueMs}ms (elapsed=${elapsedMs}ms).`,
      {
        kind: 'warning',
        mode,
        stage,
        step,
        ...(safeMeta || {}),
        hangProbe: {
          event: 'background',
          label,
          elapsedMs,
          continueMs: stateWriteContinueMs
        }
      }
    );
    stateWritePromise.then((backgroundSettled) => {
      const settledElapsedMs = Math.max(0, Date.now() - startedAtMs);
      if (backgroundSettled?.status === 'resolved') {
        if (safeMeta?.backgroundCompletionLog !== false) {
          logLineFn(
            `[hang-probe] background-complete ${label} finished after ${settledElapsedMs}ms.`,
            {
              kind: 'warning',
              mode,
              stage,
              step,
              ...(safeMeta || {}),
              hangProbe: {
                event: 'background-complete',
                label,
                elapsedMs: settledElapsedMs
              }
            }
          );
        }
        return;
      }
      if (backgroundSettled?.status === 'timed-out') {
        logLineFn(
          `[hang-probe] background-timeout ${label} after ${settledElapsedMs}ms: `
          + `${backgroundSettled?.error?.message || 'build-state patch timeout'}`,
          {
            kind: 'warning',
            mode,
            stage,
            step,
            ...(safeMeta || {}),
            hangProbe: {
              event: 'background-timeout',
              label,
              elapsedMs: settledElapsedMs
            }
          }
        );
        return;
      }
      const errorMessage = backgroundSettled?.error?.message || String(backgroundSettled?.error || 'unknown error');
      logLineFn(
        `[hang-probe] background-failed ${label} after ${settledElapsedMs}ms: ${errorMessage}`,
        {
          kind: 'warning',
          mode,
          stage,
          step,
          ...(safeMeta || {}),
          hangProbe: {
            event: 'background-failed',
            label,
            elapsedMs: settledElapsedMs
          }
        }
      );
    });
    return null;
  };

  return {
    getSchedulerStats,
    setSchedulerTelemetryStage,
    enableQueueDepthSnapshots,
    queueDepthSnapshotFileThreshold,
    recordStageCheckpoint,
    runStateWriteBestEffort
  };
};
