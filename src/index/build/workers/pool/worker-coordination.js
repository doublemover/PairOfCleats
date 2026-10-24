import util from 'node:util';

export const WORKER_DIAGNOSTIC_LIMIT = 256;
const validWorkerId = value => Number.isSafeInteger(value) && value > 0;

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
    setWorkerGcPressure = () => {},
    readProcessPressureSample,
    updatePressureState,
    maybeReduceWorkersOnPressure,
    onRuntimeObservation = () => {}
  } = input;

  const gcSampleIntervalMs = 25;
  const gcByWorker = new Map();
  const runtimeByWorker = new Map();
  const runningByWorker = new Map();
  let completedTasks = 0;
  let workerWallMs = 0;
  let currentPool = null;
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

  const forgetWorker = id => {
    gcByWorker.delete(String(id));
    runtimeByWorker.delete(id);
    runningByWorker.delete(id);
    workerNumaNodeByThreadId.delete(id);
  };
  const pruneInactiveDiagnostics = () => {
    const threads = currentPool?.threads;
    if (!Array.isArray(threads)) return;
    const live = new Set(threads.map(worker => worker.threadId).filter(validWorkerId));
    for (const key of gcByWorker.keys()) if (!live.has(Number(key))) gcByWorker.delete(key);
    for (const key of runtimeByWorker.keys()) if (!live.has(key)) runtimeByWorker.delete(key);
    for (const key of runningByWorker.keys()) if (!live.has(key)) runningByWorker.delete(key);
    for (const key of workerNumaNodeByThreadId.keys()) if (!live.has(key)) workerNumaNodeByThreadId.delete(key);
  };

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
    setWorkerGcPressure({ pool: poolLabel, worker: 'all', stage: normalizedStage, value: pressureRatio });
    const pressureSample = { rssPressure, gcPressure: heapUtilization, pressureRatio };
    if (!validWorkerId(workerId)) return pressureSample;
    const key = String(workerId);
    if (!gcByWorker.has(key) && gcByWorker.size >= WORKER_DIAGNOSTIC_LIMIT) {
      pruneInactiveDiagnostics();
      if (gcByWorker.size >= WORKER_DIAGNOSTIC_LIMIT) return pressureSample;
    }
    const previous = gcByWorker.get(key) || {
      worker: key,
      samples: 0,
      taskCompletions: 0,
      lastDurationMs: null,
      pressureRatio: null,
      heapUtilization: null,
      rssPressure: null,
      rssBytes: null,
      heapUsedBytes: null,
      heapTotalBytes: null,
      scope: 'unavailable',
      updatedAt: null
    };
    const next = {
      ...previous,
      taskCompletions: previous.taskCompletions + 1,
      lastDurationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : previous.lastDurationMs,
      updatedAt: new Date(now).toISOString()
    };
    gcByWorker.set(key, next);
    return pressureSample;
  };

  const attachPoolListeners = (poolInstance) => {
    if (!poolInstance?.on) return;
    currentPool = poolInstance;
    gcByWorker.clear();
    runtimeByWorker.clear();
    runningByWorker.clear();
    workerNumaNodeByThreadId.clear();
    poolInstance.on('message', (message) => {
      if (poolInstance !== currentPool || !message || typeof message !== 'object') return;
      if (message.type === 'worker-runtime') {
        if (!runtimeByWorker.has(message.threadId) && runtimeByWorker.size >= WORKER_DIAGNOSTIC_LIMIT) pruneInactiveDiagnostics();
        if (validWorkerId(message.threadId) && message.observation
          && (runtimeByWorker.has(message.threadId) || runtimeByWorker.size < WORKER_DIAGNOSTIC_LIMIT)) {
          runtimeByWorker.set(message.threadId, message.observation);
          onRuntimeObservation(message.observation);
        }
        return;
      }
      if (message.type === 'worker-task-start') {
        if (!runningByWorker.has(message.threadId) && runningByWorker.size >= WORKER_DIAGNOSTIC_LIMIT) pruneInactiveDiagnostics();
        if (validWorkerId(message.threadId)
          && (runningByWorker.has(message.threadId) || runningByWorker.size < WORKER_DIAGNOSTIC_LIMIT)) runningByWorker.set(message.threadId, Date.now());
        return;
      }
      if (message.type === 'worker-task') {
        runningByWorker.delete(message.threadId);
        completedTasks += 1;
        workerWallMs += Math.max(0, Number(message.durationMs) || 0);
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
            crashLogger?.enabled && crashLogger.logError({
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
    const formatPoolError = (err) => ({
      message: summarizeError(err, { fullDepth: true, maxLen: 0 }) || err?.message || String(err),
      stack: err?.stack || null,
      name: err?.name || null,
      code: err?.code || null,
      raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true })
    });
    poolInstance.on('error', (err) => {
      crashLogger?.enabled && crashLogger.logError({ phase: 'worker-pool', ...formatPoolError(err) });
    });
    poolInstance.on('workerCreate', (worker) => {
      if (poolInstance !== currentPool || !worker) return;
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
        crashLogger?.enabled && crashLogger.logError({
          phase: 'worker-thread',
          threadId: worker.threadId ?? worker.id ?? worker.worker?.threadId,
          ...formatPoolError(err)
        });
      });
      target.on('exit', (code) => {
        // Retirement is independent of exit status and crash logging. An old
        // pool's later exit must not erase a replacement pool's same-number ID.
        if (poolInstance === currentPool && validWorkerId(Number(threadId))) forgetWorker(Number(threadId));
        if (code === 0) return;
        log(`Worker thread exited with code ${code}.`);
        crashLogger?.enabled && crashLogger.logError({
          phase: 'worker-exit',
          threadId: worker.threadId ?? worker.id ?? worker.worker?.threadId,
          message: `worker exited with code ${code}`
        });
      });
    });
  };

  const gcPressureStats = () => {
    pruneInactiveDiagnostics();
    return {
      stage: normalizedStage,
      samples: gcSampleCount,
      global: {
        scope: 'parent-process',
        method: 'heap-utilization-and-aggregate-rss-pressure-proxy',
        pressureRatio: gcGlobalPressure,
        heapUtilization: gcGlobalHeapUtilization,
        rssPressure: gcGlobalRssPressure
      },
      workers: Array.from(gcByWorker.values())
    };
  };

  return {
    setNumaPinningPlan,
    attachPoolListeners,
    gcPressureStats,
    busyStats: pool => ({ actuallyRunning: pool && pool === currentPool
      ? (Array.isArray(pool.threads) ? pool.threads.filter(worker => runningByWorker.has(worker.threadId)).length
        : runningByWorker.size) : 0, completedTasks,
    workerWallMs, scope: 'worker-owned-task-wall-time', cpuTimeMs: null,
    method: 'worker-start-end-events; excludes throttle, startup and backend queue waits' }),
    runtimeObservationStats: (pool) => {
      if (!pool || pool !== currentPool) return [];
      pruneInactiveDiagnostics();
      const threads = Array.isArray(pool.threads) ? new Set(pool.threads.map((worker) => worker.threadId)) : null;
      return Array.from(runtimeByWorker.entries())
        .filter(([id]) => !threads || threads.has(id)).map(([, observation]) => observation);
    },
    getNumaPlan: () => numaPinningPlan,
    getNumaAssignmentMap: () => workerNumaNodeByThreadId
  };
};
