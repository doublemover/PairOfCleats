import os from 'node:os';
import { coerceUnitFraction } from '../../../../shared/number-coerce.js';
import { showProgress } from '../../../../shared/progress.js';

const HOST_CPU_COUNT = Array.isArray(os.cpus()) ? os.cpus().length : null;
const HEAVY_UTILIZATION_STAGES = new Set(['processing', 'relations', 'postings', 'write']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const coerceMinInteger = (value, minimum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.floor(numeric));
};

const resolveSchedulerUtilizationSample = (snapshot) => {
  const schedulerStats = snapshot?.scheduler;
  const utilization = Number(schedulerStats?.utilization?.overall);
  const pending = Number(schedulerStats?.activity?.pending);
  if (!Number.isFinite(utilization) || !Number.isFinite(pending)) return null;
  const cpuTokens = toFiniteNumber(schedulerStats?.tokens?.cpu?.total);
  const ioTokens = toFiniteNumber(schedulerStats?.tokens?.io?.total);
  return {
    utilization,
    pending,
    cpuTokens,
    ioTokens,
    tokenBudget: Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)))
  };
};

const resolveQueueDemand = (queueStats) => {
  const pending = Math.max(0, toFiniteNumber(queueStats?.pending));
  const running = Math.max(0, toFiniteNumber(queueStats?.running));
  return {
    pending,
    running,
    demand: pending + running
  };
};

const resolveSchedulerQueueDepth = (schedulerStats) => {
  if (!schedulerStats?.queues) return null;
  return Object.values(schedulerStats.queues).reduce((sum, queue) => (
    sum + toFiniteNumber(queue?.pending)
  ), 0);
};

const resolveQueuePendingSize = (queueRef) => (
  Number.isFinite(queueRef?.size) ? queueRef.size : null
);

/**
 * Create stage progress/checkpoint orchestration for one mode build.
 *
 * @param {{
 *  runtime:object,
 *  mode:'code'|'prose'|'records'|'extracted-prose',
 *  stagePlan:Array<{id:string,label:string}>,
 *  stageCheckpoints:{record:(input:object)=>void},
 *  log:(message:string)=>void
 * }} input
 * @returns {{
 *  advanceStage:(stage:{id:string,label:string})=>void,
 *  getSchedulerStats:()=>object|null,
 *  getStageNumber:()=>number,
 *  maybeEnableQueueDepthSnapshotsForFileCount:(fileCount:number)=>void,
 *  recordStageCheckpoint:(input:{stage:string,step?:string|null,label?:string|null,extra?:object|null})=>void
 * }}
 */
export const createStageOrchestration = ({
  runtime,
  mode,
  stagePlan,
  stageCheckpoints,
  log
}) => {
  const stageTotal = Array.isArray(stagePlan) ? stagePlan.length : 0;
  let stageIndex = 0;
  const getSchedulerStats = () => (runtime?.scheduler?.stats ? runtime.scheduler.stats() : null);
  const schedulerTelemetry = runtime?.scheduler
    && typeof runtime.scheduler.setTelemetryOptions === 'function'
    ? runtime.scheduler
    : null;
  const queueDepthSnapshotIntervalMs = coerceMinInteger(
    runtime?.indexingConfig?.scheduler?.queueDepthSnapshotIntervalMs,
    1000,
    5000
  );
  const queueDepthSnapshotFileThreshold = coerceMinInteger(
    runtime?.indexingConfig?.scheduler?.queueDepthSnapshotFileThreshold,
    1,
    20000
  );
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

  let lowUtilizationWarningEmitted = false;
  const utilizationTarget = coerceUnitFraction(runtime?.schedulerConfig?.utilizationAlertTarget)
    ?? 0.75;
  const utilizationAlertWindowMs = coerceMinInteger(
    runtime?.schedulerConfig?.utilizationAlertWindowMs,
    1000,
    15000
  );
  let utilizationUnderTargetSinceMs = 0;
  let utilizationTargetWarningEmitted = false;
  const queueUtilizationUnderTargetSinceMs = new Map();
  const queueUtilizationWarningEmitted = new Set();
  let lastCpuUsage = process.cpuUsage();
  let lastCpuUsageAtMs = Date.now();

  /**
   * Approximate process CPU busy percentage over the last sampling interval.
   *
   * @param {number} cpuCount
   * @returns {number|null}
   */
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
    return clamp((consumedMs / capacityMs) * 100, 0, 100);
  };

  /**
   * Capture an operational snapshot used for stage checkpoint telemetry.
   *
   * @returns {object}
   */
  const captureRuntimeSnapshot = () => {
    const schedulerStats = getSchedulerStats();
    const schedulerQueueDepth = resolveSchedulerQueueDepth(schedulerStats);
    const queueInflightBytes = runtime?.queues
      ? {
        io: toFiniteNumber(runtime.queues.io?.inflightBytes),
        cpu: toFiniteNumber(runtime.queues.cpu?.inflightBytes),
        embedding: toFiniteNumber(runtime.queues.embedding?.inflightBytes),
        proc: toFiniteNumber(runtime.queues.proc?.inflightBytes)
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
      : HOST_CPU_COUNT;
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const oneMinuteLoad = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) ? loadAvg[0] : null;
    const normalizedCpuLoad = Number.isFinite(oneMinuteLoad) && Number.isFinite(cpuCount) && cpuCount > 0
      ? clamp(oneMinuteLoad / cpuCount, 0, 1)
      : null;
    const processBusyPct = resolveProcessBusyPct(cpuCount);
    const resolvedBusyPct = Number.isFinite(normalizedCpuLoad)
      ? clamp(Math.round(normalizedCpuLoad * 1000) / 10, 0, 100)
      : (Number.isFinite(processBusyPct)
        ? clamp(Math.round(processBusyPct * 10) / 10, 0, 100)
        : null);
    const totalMem = toFiniteNumber(os.totalmem());
    const freeMem = toFiniteNumber(os.freemem());
    const memoryUtilization = totalMem > 0
      ? clamp((totalMem - freeMem) / totalMem, 0, 1)
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
          ioPending: resolveQueuePendingSize(runtime.queues.io),
          cpuPending: resolveQueuePendingSize(runtime.queues.cpu),
          embeddingPending: resolveQueuePendingSize(runtime.queues.embedding),
          procPending: resolveQueuePendingSize(runtime.queues.proc),
          schedulerPending: schedulerQueueDepth
        }
        : null,
      inFlightBytes: {
        queue: queueInflightBytes,
        telemetry: telemetryInflightBytes,
        total: Number(
          toFiniteNumber(queueInflightBytes?.io)
          + toFiniteNumber(queueInflightBytes?.cpu)
          + toFiniteNumber(queueInflightBytes?.embedding)
          + toFiniteNumber(queueInflightBytes?.proc)
          + toFiniteNumber(telemetryInflightBytes?.total)
        ) || 0
      },
      workers: {
        tokenize: workerStats || null,
        quantize: quantizeWorkerStats || null
      }
    };
  };

  /**
   * Emit a one-time warning when queue depth is high but overall utilization is
   * materially low, indicating potential scheduling bottlenecks.
   *
   * @param {{snapshot:object,stage:string,step?:string}} input
   * @returns {void}
   */
  const maybeWarnLowSchedulerUtilization = ({ snapshot, stage, step }) => {
    if (lowUtilizationWarningEmitted) return;
    const sample = resolveSchedulerUtilizationSample(snapshot);
    if (!sample) return;
    if (sample.pending < Math.max(64, sample.tokenBudget * 4)) return;
    if (sample.utilization >= 0.35) return;
    lowUtilizationWarningEmitted = true;
    log(
      `[perf] scheduler under-utilization detected at ${stage}${step ? `/${step}` : ''}: ` +
      `utilization=${sample.utilization.toFixed(2)}, pending=${Math.floor(sample.pending)}, ` +
      `tokens(cpu=${Math.floor(sample.cpuTokens)}, io=${Math.floor(sample.ioTokens)}).`
    );
  };

  /**
   * Detect sustained under-target scheduler utilization and record a stage
   * checkpoint event once per run.
   *
   * @param {{snapshot:object,stage:string,step?:string}} input
   * @returns {void}
   */
  const maybeWarnUtilizationTarget = ({ snapshot, stage, step }) => {
    if (!HEAVY_UTILIZATION_STAGES.has(String(step || stage || '').toLowerCase())) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const sample = resolveSchedulerUtilizationSample(snapshot);
    if (!sample) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (sample.pending < Math.max(16, sample.tokenBudget * 2)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (sample.utilization >= utilizationTarget) {
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
    const underSeconds = Math.max(1, Math.round(underMs / 1000));
    log(
      `[perf] sustained scheduler utilization below target at ${stage}${step ? `/${step}` : ''}: ` +
      `utilization=${sample.utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, ` +
      `pending=${Math.floor(sample.pending)}, duration=${underSeconds}s.`
    );
    stageCheckpoints.record({
      stage: 'scheduler',
      step: 'utilization-target-breach',
      label: `${stage}${step ? `/${step}` : ''}`,
      extra: {
        utilization: sample.utilization,
        target: utilizationTarget,
        pending: Math.floor(sample.pending),
        durationMs: underMs
      }
    });
  };

  /**
   * Emit per-queue under-utilization warnings for busy queues whose effective
   * throughput remains below target for the alert window.
   *
   * @param {{snapshot:object,stage:string,step?:string}} input
   * @returns {void}
   */
  const maybeWarnQueueUtilizationTarget = ({ snapshot, stage, step }) => {
    const schedulerStats = snapshot?.scheduler;
    const queues = schedulerStats?.queues && typeof schedulerStats.queues === 'object'
      ? schedulerStats.queues
      : null;
    if (!queues) return;
    const now = Date.now();
    for (const [queueName, queueStats] of Object.entries(queues)) {
      const { pending, running, demand } = resolveQueueDemand(queueStats);
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
      log(
        `[perf] sustained queue utilization below target at ${stage}${step ? `/${step}` : ''}: ` +
        `queue=${key}, utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, ` +
        `pending=${pending}, running=${running}, durationMs=${underMs}.`
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

  /**
   * Record a stage checkpoint enriched with the current runtime snapshot.
   *
   * @param {object} input
   * @param {string} input.stage
   * @param {string|null} [input.step]
   * @param {string|null} [input.label]
   * @param {object|null} [input.extra]
   */
  const recordStageCheckpoint = ({
    stage,
    step = null,
    label = null,
    extra = null
  }) => {
    const safeExtra = extra && typeof extra === 'object' ? extra : {};
    const runtimeSnapshot = captureRuntimeSnapshot();
    stageCheckpoints.record({
      stage,
      step,
      label,
      extra: {
        ...safeExtra,
        runtime: runtimeSnapshot
      }
    });
    maybeWarnLowSchedulerUtilization({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
    maybeWarnUtilizationTarget({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
    maybeWarnQueueUtilizationTarget({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
  };

  /**
   * Advance visible stage progress and retag scheduler telemetry.
   *
   * @param {{id:string,label:string}} stage
   * @returns {void}
   */
  const advanceStage = (stage) => {
    if (runtime?.overallProgress?.advance && stageIndex > 0) {
      const prevStage = stagePlan[stageIndex - 1];
      runtime.overallProgress.advance({ message: `${mode} ${prevStage.label}` });
    }
    stageIndex += 1;
    setSchedulerTelemetryStage(stage.id);
    showProgress('Stage', stageIndex, stageTotal, {
      taskId: `stage:${mode}`,
      stage: stage.id,
      mode,
      message: stage.label,
      scheduler: getSchedulerStats()
    });
  };

  const maybeEnableQueueDepthSnapshotsForFileCount = (fileCount) => {
    if (queueDepthSnapshotsEnabled) return;
    if (toFiniteNumber(fileCount, -1) < queueDepthSnapshotFileThreshold) return;
    enableQueueDepthSnapshots();
  };

  return {
    advanceStage,
    getSchedulerStats,
    getStageNumber: () => stageIndex,
    maybeEnableQueueDepthSnapshotsForFileCount,
    recordStageCheckpoint
  };
};
