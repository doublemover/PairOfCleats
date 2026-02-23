import util from 'node:util';

/**
 * Coordinate worker-process event handling and telemetry collection.
 *
 * @param {object} [input]
 * @param {string} [input.poolLabel]
 * @param {string} [input.normalizedStage]
 * @param {object|null} [input.crashLogger]
 * @param {(line:string)=>void} [input.log]
 * @param {(err:unknown, opts?:object)=>string} [input.summarizeError]
 * @param {(poolForMeta:object, assign:(meta:object)=>void, fn:(meta:object)=>unknown)=>unknown} input.withPooledPayloadMeta
 * @param {object} input.workerTaskMetricPool
 * @param {object} input.crashPayloadMetaPool
 * @param {(input:{pool:string,task:string,worker:string,status:string,seconds:number})=>void} input.observeWorkerTaskDuration
 * @param {(input:{stage:string,value:number})=>void} input.setStageGcPressure
 * @param {(input:{pool:string,worker:string,stage:string,value:number})=>void} input.setWorkerGcPressure
 * @param {()=>{heapUsed:number,heapTotal:number,rss:number,heapUtilization:number,rssPressure:number,pressureRatio:number}} input.readProcessPressureSample
 * @param {(input:{pressureRatio:number,rssPressure:number,gcPressure:number,reason?:string})=>string} input.updatePressureState
 * @param {(input:{rssPressure:number,gcPressure:number})=>Promise<void>} input.maybeReduceWorkersOnPressure
 * @returns {object}
 */
export const createWorkerProcessCoordinator = (input = {}) => {
  const {
    poolLabel = 'tokenize',
    normalizedStage = 'unknown',
    crashLogger = null,
    log = () => {},
    summarizeError = (err) => err?.message || String(err),
    withPooledPayloadMeta,
    workerTaskMetricPool,
    crashPayloadMetaPool,
    observeWorkerTaskDuration,
    setStageGcPressure,
    setWorkerGcPressure,
    readProcessPressureSample,
    updatePressureState,
    maybeReduceWorkersOnPressure
  } = input;

  const gcSampleIntervalMs = 25;
  const gcByWorker = new Map();
  let lastGcSampleAt = 0;
  let gcSampleCount = 0;
  let gcGlobalPressure = 0;
  let gcGlobalHeapUtilization = 0;
  let gcGlobalRssPressure = 0;

  let numaPinningPlan = {
    active: false,
    reason: 'disabled',
    strategy: 'interleave',
    nodeCount: 1,
    assignments: []
  };
  const workerNumaNodeByThreadId = new Map();
  let workerCreateOrdinal = 0;

  const setNumaPinningPlan = (plan) => {
    numaPinningPlan = plan && typeof plan === 'object'
      ? plan
      : {
        active: false,
        reason: 'disabled',
        strategy: 'interleave',
        nodeCount: 1,
        assignments: []
      };
    workerNumaNodeByThreadId.clear();
    workerCreateOrdinal = 0;
  };

  const updateGcTelemetry = (workerId, durationMs = null) => {
    const now = Date.now();
    if ((now - lastGcSampleAt) < gcSampleIntervalMs) return null;
    lastGcSampleAt = now;
    const {
      heapUsed,
      heapTotal,
      rss,
      heapUtilization,
      rssPressure,
      pressureRatio
    } = readProcessPressureSample();
    gcSampleCount += 1;
    gcGlobalPressure = pressureRatio;
    gcGlobalHeapUtilization = heapUtilization;
    gcGlobalRssPressure = rssPressure;
    updatePressureState({
      pressureRatio,
      rssPressure,
      gcPressure: heapUtilization,
      reason: 'worker-task'
    });
    setStageGcPressure({ stage: normalizedStage, value: pressureRatio });
    if (workerId == null) return null;
    const key = String(workerId);
    const previous = gcByWorker.get(key) || {
      worker: key,
      samples: 0,
      lastDurationMs: null,
      pressureRatio: 0,
      heapUtilization: 0,
      rssPressure: 0,
      rssBytes: 0,
      heapUsedBytes: 0,
      heapTotalBytes: 0,
      updatedAt: null
    };
    const next = {
      ...previous,
      samples: previous.samples + 1,
      lastDurationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : previous.lastDurationMs,
      pressureRatio,
      heapUtilization,
      rssPressure,
      rssBytes: rss,
      heapUsedBytes: heapUsed,
      heapTotalBytes: heapTotal,
      updatedAt: new Date(now).toISOString()
    };
    gcByWorker.set(key, next);
    setWorkerGcPressure({
      pool: poolLabel,
      worker: key,
      stage: normalizedStage,
      value: pressureRatio
    });
    return { rssPressure, gcPressure: heapUtilization, pressureRatio };
  };

  const attachPoolListeners = (poolInstance) => {
    if (!poolInstance?.on) return;
    poolInstance.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'worker-task') {
        withPooledPayloadMeta(workerTaskMetricPool, (labels) => {
          labels.pool = poolLabel;
          labels.task = message.task;
          labels.worker = message.threadId != null ? String(message.threadId) : 'unknown';
          labels.status = message.status;
          labels.seconds = Number(message.durationMs) / 1000;
        }, (labels) => {
          observeWorkerTaskDuration({
            pool: labels.pool,
            task: labels.task,
            worker: labels.worker,
            status: labels.status,
            seconds: labels.seconds
          });
        });
        const pressureSample = updateGcTelemetry(message.threadId, Number(message.durationMs));
        if (pressureSample) {
          void maybeReduceWorkersOnPressure(pressureSample).catch(() => {});
        }
        return;
      }
      if (message.type === 'worker-crash') {
        const detail = message.message || message.raw || 'unknown worker error';
        const cloneIssue = message.cloneIssue
          ? `non-cloneable ${message.cloneIssue.type}${message.cloneIssue.name ? ` (${message.cloneIssue.name})` : ''} at ${message.cloneIssue.path}`
          : null;
        const taskHint = message.task ? ` task=${message.task}` : '';
        const stageHint = message.stage ? ` stage=${message.stage}` : '';
        const suffix = [cloneIssue, `${taskHint}${stageHint}`.trim()].filter(Boolean).join(' | ');
        log(`Worker crash reported: ${detail}${suffix ? ` | ${suffix}` : ''}`);
        if (crashLogger?.enabled) {
          withPooledPayloadMeta(crashPayloadMetaPool, (meta) => {
            meta.threadId = message.threadId ?? null;
          }, (payloadMeta) => {
            crashLogger.logError({
              phase: 'worker-thread',
              message: message.message || 'worker crash',
              stack: message.stack || null,
              name: message.name || null,
              code: null,
              task: message.label || null,
              cloneIssue: message.cloneIssue || null,
              cloneStage: message.stage || null,
              payloadMeta,
              raw: message.raw || null,
              cause: message.cause || null
            });
          });
        }
      }
    });
    if (!crashLogger?.enabled) return;
    const formatPoolError = (err) => ({
      message: summarizeError(err, { fullDepth: true, maxLen: 0 }) || err?.message || String(err),
      stack: err?.stack || null,
      name: err?.name || null,
      code: err?.code || null,
      raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true })
    });
    poolInstance.on('error', (err) => {
      crashLogger.logError({ phase: 'worker-pool', ...formatPoolError(err) });
    });
    poolInstance.on('workerCreate', (worker) => {
      if (!worker) return;
      const threadId = worker.threadId ?? worker.id ?? worker.worker?.threadId;
      if (numaPinningPlan.active && Number.isFinite(Number(threadId))) {
        const assignments = Array.isArray(numaPinningPlan.assignments)
          ? numaPinningPlan.assignments
          : [];
        if (assignments.length > 0) {
          const slot = workerCreateOrdinal % assignments.length;
          const node = assignments[slot];
          workerCreateOrdinal += 1;
          if (Number.isFinite(Number(node))) {
            workerNumaNodeByThreadId.set(Number(threadId), Math.floor(Number(node)));
          }
        }
      }
      const target = typeof worker.on === 'function'
        ? worker
        : (worker?.worker && typeof worker.worker.on === 'function'
          ? worker.worker
          : null);
      if (!target) return;
      target.on('error', (err) => {
        const detail = summarizeError(err, { fullDepth: true, maxLen: 0 }) || err?.message || String(err);
        log(`Worker thread error: ${detail}`);
        crashLogger.logError({
          phase: 'worker-thread',
          threadId: worker.threadId ?? worker.id ?? worker.worker?.threadId,
          ...formatPoolError(err)
        });
      });
      target.on('exit', (code) => {
        if (Number.isFinite(Number(threadId))) {
          workerNumaNodeByThreadId.delete(Number(threadId));
        }
        if (code === 0) return;
        log(`Worker thread exited with code ${code}.`);
        crashLogger.logError({
          phase: 'worker-exit',
          threadId: worker.threadId ?? worker.id ?? worker.worker?.threadId,
          message: `worker exited with code ${code}`
        });
      });
    });
  };

  const gcPressureStats = () => ({
    stage: normalizedStage,
    samples: gcSampleCount,
    global: {
      pressureRatio: gcGlobalPressure,
      heapUtilization: gcGlobalHeapUtilization,
      rssPressure: gcGlobalRssPressure
    },
    workers: Array.from(gcByWorker.values())
  });

  return {
    setNumaPinningPlan,
    attachPoolListeners,
    gcPressureStats,
    getNumaPlan: () => numaPinningPlan,
    getNumaAssignmentMap: () => workerNumaNodeByThreadId
  };
};
