import PQueue from 'p-queue';
import os from 'node:os';
import { createAbortError, throwIfAborted } from './abort.js';
import { coerceUnitFraction } from './number-coerce.js';

/**
 * Create shared task queues for IO, CPU, and embeddings work.
 * @param {{ioConcurrency:number,cpuConcurrency:number,embeddingConcurrency?:number,procConcurrency?:number,ioPendingLimit?:number,cpuPendingLimit?:number,embeddingPendingLimit?:number,procPendingLimit?:number,ioPendingBytesLimit?:number,cpuPendingBytesLimit?:number,embeddingPendingBytesLimit?:number,procPendingBytesLimit?:number}} input
 * @returns {{io:PQueue,cpu:PQueue,embedding:PQueue,proc?:PQueue}}
 */
export function createTaskQueues({
  ioConcurrency,
  cpuConcurrency,
  embeddingConcurrency,
  procConcurrency,
  ioPendingLimit,
  cpuPendingLimit,
  embeddingPendingLimit,
  procPendingLimit,
  ioPendingBytesLimit,
  cpuPendingBytesLimit,
  embeddingPendingBytesLimit,
  procPendingBytesLimit
}) {
  const io = new PQueue({ concurrency: Math.max(1, Math.floor(ioConcurrency || 1)) });
  const cpu = new PQueue({ concurrency: Math.max(1, Math.floor(cpuConcurrency || 1)) });
  const embeddingLimit = Number.isFinite(Number(embeddingConcurrency))
    ? Math.max(1, Math.floor(Number(embeddingConcurrency)))
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const embedding = new PQueue({ concurrency: embeddingLimit });
  const procLimit = Number.isFinite(Number(procConcurrency))
    ? Math.max(1, Math.floor(Number(procConcurrency)))
    : null;
  const proc = procLimit ? new PQueue({ concurrency: procLimit }) : null;
  const applyLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPending = Math.floor(limit);
  };
  const applyBytesLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPendingBytes = Math.floor(limit);
  };
  applyLimit(io, ioPendingLimit);
  applyLimit(cpu, cpuPendingLimit);
  applyLimit(embedding, embeddingPendingLimit);
  applyBytesLimit(io, ioPendingBytesLimit);
  applyBytesLimit(cpu, cpuPendingBytesLimit);
  applyBytesLimit(embedding, embeddingPendingBytesLimit);
  if (proc) {
    applyLimit(proc, procPendingLimit);
    applyBytesLimit(proc, procPendingBytesLimit);
    return { io, cpu, embedding, proc };
  }
  return { io, cpu, embedding };
}

/**
 * Run async work over items using a shared queue.
 * @param {PQueue} queue
 * @param {Array<any>} items
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onError?:(error:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onProgress?:(state:{done:number,total:number})=>Promise<void>,bestEffort?:boolean,signal?:AbortSignal,abortError?:Error,retries?:number,retryDelayMs?:number,backoffMs?:number,onBeforeDispatch?:(ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,estimateBytes?:(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>number}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithQueue(queue, items, worker, options = {}) {
  const list = Array.from(items || []);
  if (!list.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const onBeforeDispatch = typeof options.onBeforeDispatch === 'function'
    ? options.onBeforeDispatch
    : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const backoffMs = Number.isFinite(Number(options.backoffMs)) ? Math.max(0, Math.floor(Number(options.backoffMs))) : null;
  const delayMs = backoffMs != null ? backoffMs : retryDelayMs;
  const bestEffort = options.bestEffort === true;
  const signal = options.signal && typeof options.signal.aborted === 'boolean' ? options.signal : null;
  const abortError = options.abortError instanceof Error ? options.abortError : createAbortError();
  const results = collectResults ? new Array(list.length) : null;
  const pendingSignals = new Set();
  const maxPending = Number.isFinite(queue?.maxPending) ? queue.maxPending : null;
  const maxPendingBytes = Number.isFinite(queue?.maxPendingBytes)
    ? Math.max(1, Math.floor(Number(queue.maxPendingBytes)))
    : null;
  const estimateBytes = typeof options.estimateBytes === 'function'
    ? options.estimateBytes
    : null;
  if (queue && !Number.isFinite(Number(queue.inflightBytes))) {
    queue.inflightBytes = 0;
  }
  let aborted = false;
  let firstError = null;
  const errors = [];
  let doneCount = 0;
  const normalizePendingBytes = (value) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const resolveItemBytes = (item, ctx) => {
    if (estimateBytes) return normalizePendingBytes(estimateBytes(item, ctx));
    if (Number.isFinite(Number(item?.bytes))) return normalizePendingBytes(item.bytes);
    if (Number.isFinite(Number(item?.size))) return normalizePendingBytes(item.size);
    if (Number.isFinite(Number(item?.stat?.size))) return normalizePendingBytes(item.stat.size);
    return 0;
  };
  const readInflightBytes = () => normalizePendingBytes(queue?.inflightBytes);
  const setInflightBytes = (value) => {
    if (!queue) return;
    queue.inflightBytes = normalizePendingBytes(value);
  };
  const markAborted = () => {
    if (aborted) return;
    aborted = true;
  };
  const recordError = async (err, ctx) => {
    let error = err || new Error('Queue task failed');
    if (onError) {
      try {
        await onError(error, ctx);
      } catch (callbackErr) {
        error = callbackErr;
      }
    }
    if (bestEffort) {
      errors.push(error);
      return;
    }
    if (!firstError) {
      firstError = error;
      markAborted();
    }
  };
  const recordProgress = async () => {
    if (!onProgress) return;
    try {
      await onProgress({ done: doneCount, total: list.length });
    } catch (err) {
      await recordError(err, { index: -1, item: null, signal });
    }
  };
  const abortHandler = () => {
    markAborted();
  };
  if (signal) {
    if (signal.aborted) {
      markAborted();
    } else {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  }
  const runWorker = async (item, ctx) => {
    let attempt = 0;
    while (true) {
      throwIfAborted(signal);
      let result;
      try {
        result = await worker(item, ctx);
      } catch (err) {
        attempt += 1;
        if (attempt > retries) throw err;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        continue;
      }
      if (collectResults) results[ctx.index] = result;
      if (onResult) {
        await onResult(result, ctx);
      }
      return result;
    }
  };
  const enqueue = async (item, index) => {
    const ctx = { index, item, signal };
    let taskBytes = 0;
    if (aborted) return;
    if (signal?.aborted) {
      markAborted();
      return;
    }
    if (onBeforeDispatch) {
      try {
        await onBeforeDispatch(ctx);
      } catch (err) {
        await recordError(err, ctx);
        doneCount += 1;
        await recordProgress();
        return;
      }
      if (aborted || signal?.aborted) {
        if (signal?.aborted) markAborted();
        return;
      }
    }
    try {
      taskBytes = resolveItemBytes(item, ctx);
    } catch (err) {
      await recordError(err, ctx);
      doneCount += 1;
      await recordProgress();
      return;
    }
    if (maxPending) {
      while (pendingSignals.size >= maxPending && !aborted) {
        await Promise.race(pendingSignals);
      }
    }
    if (maxPendingBytes && taskBytes > 0) {
      while (!aborted) {
        const inflightBytes = readInflightBytes();
        const fits = inflightBytes + taskBytes <= maxPendingBytes;
        const oversizeSingle = inflightBytes === 0 && pendingSignals.size === 0;
        if (fits || oversizeSingle) break;
        if (pendingSignals.size === 0) break;
        await Promise.race(pendingSignals);
      }
    }
    if (aborted) return;
    if (taskBytes > 0) {
      setInflightBytes(readInflightBytes() + taskBytes);
    }
    let task;
    try {
      task = queue.add(() => runWorker(item, ctx), { bytes: taskBytes });
    } catch (err) {
      if (taskBytes > 0) {
        setInflightBytes(readInflightBytes() - taskBytes);
      }
      await recordError(err, ctx);
      doneCount += 1;
      await recordProgress();
      return;
    }
    const settled = task.then(
      async () => {
        doneCount += 1;
        await recordProgress();
      },
      async (err) => {
        await recordError(err, ctx);
        doneCount += 1;
        await recordProgress();
      }
    );
    pendingSignals.add(settled);
    void task.catch(() => {});
    const cleanup = settled.finally(() => {
      if (taskBytes > 0) {
        setInflightBytes(readInflightBytes() - taskBytes);
      }
      pendingSignals.delete(settled);
    });
    void cleanup.catch(() => {});
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted && !bestEffort) break;
    }
    await Promise.all(pendingSignals);
    if (signal?.aborted) throw abortError;
    if (firstError) throw firstError;
    if (bestEffort && errors.length) {
      throw new AggregateError(errors, 'runWithQueue best-effort failures');
    }
    return results;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Run async work over items with a per-call concurrency limit.
 * @param {Array<any>} items
 * @param {number} limit
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,signal?:AbortSignal}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithConcurrency(items, limit, worker, options = {}) {
  const queue = new PQueue({ concurrency: Math.max(1, Math.floor(limit || 1)) });
  return runWithQueue(queue, items, worker, options);
}

/**
 * Create a build scheduler that coordinates CPU/IO/memory tokens across queues.
 * This is intentionally generic and can be wired into Stage1/2/4 and embeddings.
 * @param {{enabled?:boolean,lowResourceMode?:boolean,cpuTokens?:number,ioTokens?:number,memoryTokens?:number,starvationMs?:number,maxInFlightBytes?:number,queues?:Record<string,{priority?:number,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number}>,traceMaxSamples?:number,queueDepthSnapshotMaxSamples?:number,traceIntervalMs?:number,queueDepthSnapshotIntervalMs?:number,queueDepthSnapshotsEnabled?:boolean}} input
 * @returns {{schedule:(queueName:string,tokens?:{cpu?:number,io?:number,mem?:number,bytes?:number},fn?:()=>Promise<any>)=>Promise<any>,stats:()=>any,shutdown:()=>void,setLimits:(limits:{cpuTokens?:number,ioTokens?:number,memoryTokens?:number})=>void,setTelemetryOptions:(options:{stage?:string,queueDepthSnapshotsEnabled?:boolean,queueDepthSnapshotIntervalMs?:number,traceIntervalMs?:number})=>void}}
 */
export function createBuildScheduler(input = {}) {
  const enabled = input.enabled !== false;
  const lowResourceMode = input.lowResourceMode === true;
  const starvationMs = Number.isFinite(Number(input.starvationMs))
    ? Math.max(0, Math.floor(Number(input.starvationMs)))
    : 30000;
  const normalizeTokenPool = (value) => {
    if (value == null) return 1;
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return 1;
    // Zero-token pools deadlock queued work that requires that resource.
    return Math.max(1, parsed);
  };
  let cpuTokens = normalizeTokenPool(input.cpuTokens);
  let ioTokens = normalizeTokenPool(input.ioTokens);
  let memoryTokens = normalizeTokenPool(input.memoryTokens);
  const adaptiveEnabled = input.adaptive === true;
  const baselineLimits = {
    cpu: cpuTokens,
    io: ioTokens,
    mem: memoryTokens
  };
  const maxLimits = {
    cpu: Math.max(baselineLimits.cpu, normalizeTokenPool(input.maxCpuTokens ?? cpuTokens)),
    io: Math.max(baselineLimits.io, normalizeTokenPool(input.maxIoTokens ?? ioTokens)),
    mem: Math.max(baselineLimits.mem, normalizeTokenPool(input.maxMemoryTokens ?? memoryTokens))
  };
  const normalizeByteLimit = (value) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const normalizeByteCount = (value) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const normalizeRequest = (req = {}) => ({
    cpu: Math.max(0, Math.floor(Number(req?.cpu || 0))),
    io: Math.max(0, Math.floor(Number(req?.io || 0))),
    mem: Math.max(0, Math.floor(Number(req?.mem || 0))),
    bytes: normalizeByteCount(req?.bytes)
  });

  const queueConfig = input.queues || {};
  const queues = new Map();
  const queueOrder = [];
  const nowMs = () => Date.now();
  const globalMaxInFlightBytes = normalizeByteLimit(input.maxInFlightBytes);
  const startedAtMs = nowMs();
  const counters = {
    scheduled: 0,
    started: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    starvation: 0,
    rejectedByReason: {
      maxPending: 0,
      maxPendingBytes: 0,
      shutdown: 0,
      cleared: 0
    }
  };
  const totalInFlightBytes = () => queueOrder.reduce(
    (sum, queue) => sum + normalizeByteCount(queue.inFlightBytes),
    0
  );

  const ensureQueue = (name) => {
    if (queues.has(name)) return queues.get(name);
    const cfg = queueConfig[name] || {};
    const state = {
      name,
      priority: Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 50,
      weight: Number.isFinite(Number(cfg.weight)) ? Math.max(1, Math.floor(Number(cfg.weight))) : 1,
      maxPending: Number.isFinite(Number(cfg.maxPending)) ? Math.max(1, Math.floor(Number(cfg.maxPending))) : null,
      maxPendingBytes: normalizeByteLimit(cfg.maxPendingBytes),
      maxInFlightBytes: normalizeByteLimit(cfg.maxInFlightBytes),
      pending: [],
      pendingBytes: 0,
      inFlightBytes: 0,
      running: 0,
      stats: {
        scheduled: 0,
        started: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        starvation: 0,
        rejectedMaxPending: 0,
        rejectedMaxPendingBytes: 0
      }
    };
    queues.set(name, state);
    queueOrder.push(state);
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return state;
  };

  const applyQueueConfig = (queue, config) => {
    if (!queue || !config || typeof config !== 'object') return;
    if (Number.isFinite(Number(config.priority))) {
      queue.priority = Number(config.priority);
    }
    if (Number.isFinite(Number(config.maxPending))) {
      queue.maxPending = Math.max(1, Math.floor(Number(config.maxPending)));
    }
    if (config.maxPendingBytes != null) {
      queue.maxPendingBytes = normalizeByteLimit(config.maxPendingBytes);
    }
    if (config.maxInFlightBytes != null) {
      queue.maxInFlightBytes = normalizeByteLimit(config.maxInFlightBytes);
    }
    if (Number.isFinite(Number(config.weight))) {
      queue.weight = Math.max(1, Math.floor(Number(config.weight)));
    }
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  };

  const registerQueue = (queueName, config = {}) => {
    const queue = ensureQueue(queueName);
    applyQueueConfig(queue, config);
    return queue;
  };

  const registerQueues = (configMap = {}) => {
    if (!configMap || typeof configMap !== 'object') return;
    for (const [queueName, config] of Object.entries(configMap)) {
      registerQueue(queueName, config);
    }
  };
  const normalizeTelemetryStage = (value, fallback = 'init') => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
  };
  let telemetryStage = normalizeTelemetryStage(input.telemetryStage, 'init');
  let traceIntervalMs = Number.isFinite(Number(input.traceIntervalMs))
    ? Math.max(100, Math.floor(Number(input.traceIntervalMs)))
    : 1000;
  let queueDepthSnapshotIntervalMs = Number.isFinite(Number(input.queueDepthSnapshotIntervalMs))
    ? Math.max(1000, Math.floor(Number(input.queueDepthSnapshotIntervalMs)))
    : 5000;
  let queueDepthSnapshotsEnabled = input.queueDepthSnapshotsEnabled === true;
  const traceMaxSamples = Number.isFinite(Number(input.traceMaxSamples))
    ? Math.max(16, Math.floor(Number(input.traceMaxSamples)))
    : 512;
  const queueDepthSnapshotMaxSamples = Number.isFinite(Number(input.queueDepthSnapshotMaxSamples))
    ? Math.max(16, Math.floor(Number(input.queueDepthSnapshotMaxSamples)))
    : 512;
  const schedulingTrace = [];
  const queueDepthSnapshots = [];
  let lastTraceAtMs = 0;
  let lastQueueDepthSnapshotAtMs = 0;

  const cloneTokenState = () => ({
    cpu: { ...tokens.cpu },
    io: { ...tokens.io },
    mem: { ...tokens.mem }
  });

  const buildQueueDepthState = () => {
    const byQueue = {};
    let pending = 0;
    let pendingBytes = 0;
    let running = 0;
    let inFlightBytes = 0;
    for (const q of queueOrder) {
      pending += q.pending.length;
      pendingBytes += normalizeByteCount(q.pendingBytes);
      running += q.running;
      inFlightBytes += normalizeByteCount(q.inFlightBytes);
      byQueue[q.name] = {
        pending: q.pending.length,
        pendingBytes: normalizeByteCount(q.pendingBytes),
        running: q.running,
        inFlightBytes: normalizeByteCount(q.inFlightBytes)
      };
    }
    return { byQueue, pending, pendingBytes, running, inFlightBytes };
  };

  const appendBounded = (list, value, maxCount) => {
    list.push(value);
    while (list.length > maxCount) list.shift();
  };

  const captureSchedulingTrace = ({
    now = nowMs(),
    reason = 'interval',
    force = false
  } = {}) => {
    if (!force && (now - lastTraceAtMs) < traceIntervalMs) return null;
    const queueDepth = buildQueueDepthState();
    const sample = {
      at: new Date(now).toISOString(),
      elapsedMs: Math.max(0, now - startedAtMs),
      stage: telemetryStage,
      reason,
      tokens: cloneTokenState(),
      activity: {
        pending: queueDepth.pending,
        pendingBytes: queueDepth.pendingBytes,
        running: queueDepth.running,
        inFlightBytes: queueDepth.inFlightBytes
      },
      queues: queueDepth.byQueue
    };
    lastTraceAtMs = now;
    appendBounded(schedulingTrace, sample, traceMaxSamples);
    return sample;
  };

  const captureQueueDepthSnapshot = ({
    now = nowMs(),
    reason = 'interval',
    force = false
  } = {}) => {
    if (!queueDepthSnapshotsEnabled) return null;
    if (!force && (now - lastQueueDepthSnapshotAtMs) < queueDepthSnapshotIntervalMs) return null;
    const queueDepth = buildQueueDepthState();
    const snapshot = {
      at: new Date(now).toISOString(),
      elapsedMs: Math.max(0, now - startedAtMs),
      stage: telemetryStage,
      reason,
      pending: queueDepth.pending,
      pendingBytes: queueDepth.pendingBytes,
      running: queueDepth.running,
      inFlightBytes: queueDepth.inFlightBytes,
      queues: queueDepth.byQueue
    };
    lastQueueDepthSnapshotAtMs = now;
    appendBounded(queueDepthSnapshots, snapshot, queueDepthSnapshotMaxSamples);
    return snapshot;
  };

  const captureTelemetryIfDue = (reason = 'interval') => {
    const now = nowMs();
    captureSchedulingTrace({ now, reason });
    captureQueueDepthSnapshot({ now, reason });
  };

  const cloneQueueDepthByName = (queuesByName = {}) => {
    const out = {};
    for (const [queueName, value] of Object.entries(queuesByName || {})) {
      out[queueName] = {
        pending: Number(value?.pending) || 0,
        pendingBytes: Number(value?.pendingBytes) || 0,
        running: Number(value?.running) || 0,
        inFlightBytes: Number(value?.inFlightBytes) || 0
      };
    }
    return out;
  };

  const cloneQueueDepthEntries = (entries) => entries.map((entry) => {
    const queuesByName = {};
    for (const [queueName, value] of Object.entries(entry?.queues || {})) {
      queuesByName[queueName] = {
        pending: Number(value?.pending) || 0,
        pendingBytes: Number(value?.pendingBytes) || 0,
        running: Number(value?.running) || 0,
        inFlightBytes: Number(value?.inFlightBytes) || 0
      };
    }
    return {
      ...entry,
      pendingBytes: Number(entry?.pendingBytes) || 0,
      inFlightBytes: Number(entry?.inFlightBytes) || 0,
      queues: queuesByName
    };
  });

  const cloneTraceEntries = (entries) => entries.map((entry) => ({
    ...entry,
    tokens: {
      cpu: { ...(entry?.tokens?.cpu || {}) },
      io: { ...(entry?.tokens?.io || {}) },
      mem: { ...(entry?.tokens?.mem || {}) }
    },
    activity: {
      pending: Number(entry?.activity?.pending) || 0,
      pendingBytes: Number(entry?.activity?.pendingBytes) || 0,
      running: Number(entry?.activity?.running) || 0,
      inFlightBytes: Number(entry?.activity?.inFlightBytes) || 0
    },
    queues: cloneQueueDepthByName(entry?.queues || {})
  }));

  const tokenState = () => ({
    cpu: { total: cpuTokens, used: 0 },
    io: { total: ioTokens, used: 0 },
    mem: { total: memoryTokens, used: 0 }
  });
  let tokens = tokenState();
  let shuttingDown = false;
  let lastAdaptiveAt = 0;
  const adaptiveMinIntervalMs = Number.isFinite(Number(input.adaptiveIntervalMs))
    ? Math.max(50, Math.floor(Number(input.adaptiveIntervalMs)))
    : 250;
  const adaptiveTargetUtilization = coerceUnitFraction(input.adaptiveTargetUtilization) ?? 0.85;
  const adaptiveStep = Number.isFinite(Number(input.adaptiveStep))
    ? Math.max(1, Math.floor(Number(input.adaptiveStep)))
    : 1;
  const adaptiveMemoryReserveMb = Number.isFinite(Number(input.adaptiveMemoryReserveMb))
    ? Math.max(0, Math.floor(Number(input.adaptiveMemoryReserveMb)))
    : 2048;
  const adaptiveMemoryPerTokenMb = Number.isFinite(Number(input.adaptiveMemoryPerTokenMb))
    ? Math.max(64, Math.floor(Number(input.adaptiveMemoryPerTokenMb)))
    : 1024;
  let adaptiveCurrentIntervalMs = adaptiveMinIntervalMs;
  let adaptiveMode = 'steady';
  let smoothedUtilization = null;
  let smoothedPendingPressure = null;
  let smoothedStarvation = null;
  let burstModeUntilMs = 0;
  const telemetryTickMs = Number.isFinite(Number(input.telemetryTickMs))
    ? Math.max(100, Math.floor(Number(input.telemetryTickMs)))
    : 250;
  const telemetryTimer = enabled && !lowResourceMode
    ? setInterval(() => {
      if (shuttingDown) return;
      captureTelemetryIfDue('interval');
    }, telemetryTickMs)
    : null;
  telemetryTimer?.unref?.();

  const maybeAdaptTokens = () => {
    if (!adaptiveEnabled || shuttingDown) return;
    const now = nowMs();
    if ((now - lastAdaptiveAt) < adaptiveCurrentIntervalMs) return;
    lastAdaptiveAt = now;
    let totalPending = 0;
    let totalPendingBytes = 0;
    let totalRunning = 0;
    let totalRunningBytes = 0;
    let starvedQueues = 0;
    for (const q of queueOrder) {
      totalPending += q.pending.length;
      totalPendingBytes += normalizeByteCount(q.pendingBytes);
      totalRunning += q.running;
      totalRunningBytes += normalizeByteCount(q.inFlightBytes);
      if (q.pending.length > 0 && q.running === 0) {
        starvedQueues += 1;
      }
    }
    const tokenBudget = Math.max(1, tokens.cpu.total + tokens.io.total);
    const memoryTokenBudgetBytes = Math.max(1, tokens.mem.total) * adaptiveMemoryPerTokenMb * 1024 * 1024;
    const pendingBytePressure = totalPendingBytes > Math.max(
      4 * 1024 * 1024,
      Math.floor(memoryTokenBudgetBytes * 0.2)
    );
    const runningBytePressure = totalRunningBytes > Math.max(
      8 * 1024 * 1024,
      Math.floor(memoryTokenBudgetBytes * 0.35)
    );
    const bytePressure = pendingBytePressure || runningBytePressure;
    const pendingDemand = totalPending > 0;
    const pendingPressure = totalPending > Math.max(1, Math.floor(tokenBudget * 0.35));
    const mostlyIdle = totalPending === 0 && totalRunning === 0 && totalRunningBytes === 0;
    const cpuUtilization = tokens.cpu.total > 0 ? (tokens.cpu.used / tokens.cpu.total) : 0;
    const ioUtilization = tokens.io.total > 0 ? (tokens.io.used / tokens.io.total) : 0;
    const memUtilization = tokens.mem.total > 0 ? (tokens.mem.used / tokens.mem.total) : 0;
    const utilization = Math.max(cpuUtilization, ioUtilization, memUtilization);
    const smooth = (prev, next, alpha = 0.25) => (
      prev == null ? next : ((prev * (1 - alpha)) + (next * alpha))
    );
    smoothedUtilization = smooth(smoothedUtilization, utilization);
    smoothedPendingPressure = smooth(
      smoothedPendingPressure,
      Math.max(totalPending / Math.max(1, tokenBudget), totalPendingBytes / Math.max(1, memoryTokenBudgetBytes))
    );
    smoothedStarvation = smooth(
      smoothedStarvation,
      queueOrder.length > 0 ? (starvedQueues / queueOrder.length) : 0
    );
    const utilizationDeficit = utilization < adaptiveTargetUtilization;
    const smoothedUtilizationDeficit = (smoothedUtilization ?? utilization) < adaptiveTargetUtilization;
    const severeUtilizationDeficit = utilization < (adaptiveTargetUtilization * 0.7);
    const starvationScore = starvedQueues + Math.round((smoothedStarvation ?? 0) * 2);
    if (pendingPressure || bytePressure || starvationScore > 0) {
      adaptiveCurrentIntervalMs = Math.max(50, Math.floor(adaptiveMinIntervalMs * 0.5));
    } else if (mostlyIdle) {
      adaptiveCurrentIntervalMs = Math.min(2000, Math.max(adaptiveMinIntervalMs, Math.floor(adaptiveMinIntervalMs * 2)));
    } else {
      adaptiveCurrentIntervalMs = adaptiveMinIntervalMs;
    }
    const totalMem = Number(os.totalmem()) || 0;
    const freeMem = Number(os.freemem()) || 0;
    const freeRatio = totalMem > 0 ? (freeMem / totalMem) : null;
    const headroomBytes = Number.isFinite(totalMem) && Number.isFinite(freeMem)
      ? Math.max(0, freeMem)
      : 0;
    const memoryLowHeadroom = Number.isFinite(freeRatio) && freeRatio < 0.15;
    const memoryHighHeadroom = !Number.isFinite(freeRatio) || freeRatio > 0.25;
    let memoryTokenHeadroomCap = maxLimits.mem;
    if (Number.isFinite(freeMem) && freeMem > 0) {
      const reserveBytes = adaptiveMemoryReserveMb * 1024 * 1024;
      const bytesPerToken = adaptiveMemoryPerTokenMb * 1024 * 1024;
      const availableBytes = Math.max(0, freeMem - reserveBytes);
      const headroomTokens = Math.max(1, Math.floor(availableBytes / Math.max(1, bytesPerToken)));
      memoryTokenHeadroomCap = Math.max(
        baselineLimits.mem,
        Math.min(maxLimits.mem, headroomTokens)
      );
      if (tokens.mem.total > memoryTokenHeadroomCap) {
        tokens.mem.total = Math.max(tokens.mem.used, memoryTokenHeadroomCap);
      }
    }

    if (memoryLowHeadroom) {
      adaptiveMode = 'steady';
      tokens.cpu.total = Math.max(baselineLimits.cpu, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(baselineLimits.io, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(
        baselineLimits.mem,
        tokens.mem.used,
        Math.min(memoryTokenHeadroomCap, tokens.mem.total - adaptiveStep)
      );
      return;
    }

    if (memoryHighHeadroom && pendingDemand && smoothedUtilizationDeficit) {
      burstModeUntilMs = Math.max(burstModeUntilMs, now + 1500);
    }
    const burstMode = now < burstModeUntilMs;
    const queueStarvation = starvationScore > 0;
    const shouldScaleFromHeadroom = memoryHighHeadroom
      && pendingDemand
      && (smoothedUtilizationDeficit || queueStarvation || burstMode)
      && (totalRunning > 0 || queueStarvation || severeUtilizationDeficit);
    const shouldScale = memoryHighHeadroom && (
      pendingPressure
      || bytePressure
      || queueStarvation
      || burstMode
      || shouldScaleFromHeadroom
      || (pendingDemand && smoothedUtilizationDeficit)
    );
    if (shouldScale) {
      adaptiveMode = burstMode ? 'burst' : 'steady';
      const pressureScale = pendingPressure || bytePressure;
      const scaleStep = (pressureScale && (queueStarvation || severeUtilizationDeficit))
        ? adaptiveStep + 2
        : ((pressureScale || queueStarvation) ? adaptiveStep + 1 : adaptiveStep);
      const effectiveScaleStep = burstMode ? (scaleStep + 1) : scaleStep;
      const nextCpu = Math.min(maxLimits.cpu, tokens.cpu.total + effectiveScaleStep);
      const nextIo = Math.min(maxLimits.io, tokens.io.total + effectiveScaleStep);
      const nextMem = Math.min(maxLimits.mem, memoryTokenHeadroomCap, tokens.mem.total + adaptiveStep);
      tokens.cpu.total = nextCpu;
      tokens.io.total = nextIo;
      tokens.mem.total = nextMem;
      return;
    }
    const settleMode = !mostlyIdle
      && !pendingDemand
      && !bytePressure
      && now >= burstModeUntilMs
      && utilization >= adaptiveTargetUtilization
      && (
        tokens.cpu.total > baselineLimits.cpu
        || tokens.io.total > baselineLimits.io
        || tokens.mem.total > baselineLimits.mem
      );
    if (settleMode) {
      adaptiveMode = 'settle';
      tokens.cpu.total = Math.max(baselineLimits.cpu, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(baselineLimits.io, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(baselineLimits.mem, tokens.mem.used, tokens.mem.total - adaptiveStep);
      return;
    }

    if (
      memoryHighHeadroom
      && headroomBytes > (adaptiveMemoryReserveMb * 1024 * 1024)
      && (totalPending > 0 || totalPendingBytes > 0)
      && tokens.mem.total < memoryTokenHeadroomCap
    ) {
      tokens.mem.total = Math.min(memoryTokenHeadroomCap, tokens.mem.total + adaptiveStep);
    }

    if (mostlyIdle) {
      adaptiveMode = 'steady';
      tokens.cpu.total = Math.max(baselineLimits.cpu, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(baselineLimits.io, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(baselineLimits.mem, tokens.mem.used, tokens.mem.total - adaptiveStep);
    }
  };

  const canStart = (queue, req) => {
    const normalized = normalizeRequest(req);
    if (
      tokens.cpu.used + normalized.cpu > tokens.cpu.total
      || tokens.io.used + normalized.io > tokens.io.total
      || tokens.mem.used + normalized.mem > tokens.mem.total
    ) {
      return false;
    }
    const queueCap = queue?.maxInFlightBytes;
    if (queueCap && normalized.bytes > 0) {
      const queueBytes = normalizeByteCount(queue.inFlightBytes);
      const oversizeSingle = queueBytes === 0;
      if (!oversizeSingle && queueBytes + normalized.bytes > queueCap) {
        return false;
      }
    }
    if (globalMaxInFlightBytes && normalized.bytes > 0) {
      const runningBytes = totalInFlightBytes();
      const oversizeSingle = runningBytes === 0;
      if (!oversizeSingle && runningBytes + normalized.bytes > globalMaxInFlightBytes) {
        return false;
      }
    }
    return true;
  };

  const reserve = (queue, req) => {
    const normalized = normalizeRequest(req);
    tokens.cpu.used += normalized.cpu;
    tokens.io.used += normalized.io;
    tokens.mem.used += normalized.mem;
    if (queue && normalized.bytes > 0) {
      queue.inFlightBytes = normalizeByteCount(queue.inFlightBytes) + normalized.bytes;
    }
    return normalized;
  };

  const release = (queue, used) => {
    const normalized = normalizeRequest(used || {});
    tokens.cpu.used = Math.max(0, tokens.cpu.used - normalized.cpu);
    tokens.io.used = Math.max(0, tokens.io.used - normalized.io);
    tokens.mem.used = Math.max(0, tokens.mem.used - normalized.mem);
    if (queue && normalized.bytes > 0) {
      queue.inFlightBytes = Math.max(0, normalizeByteCount(queue.inFlightBytes) - normalized.bytes);
    }
  };

  const findStartableIndex = (queue) => {
    if (!queue?.pending?.length) return -1;
    for (let i = 0; i < queue.pending.length; i += 1) {
      if (canStart(queue, queue.pending[i].tokens)) return i;
    }
    return -1;
  };

  const pickNextQueue = () => {
    if (!queueOrder.length) return null;
    let starving = null;
    let picked = null;
    for (const q of queueOrder) {
      if (!q.pending.length) continue;
      const index = findStartableIndex(q);
      if (index < 0) continue;
      const waited = nowMs() - q.pending[0].enqueuedAt;
      if (waited >= starvationMs && (!starving || waited > starving.waited)) {
        starving = { queue: q, waited, index };
        continue;
      }
      const weightBoostMs = Math.max(1, Number(q.weight) || 1) * 250;
      const priorityPenaltyMs = Math.max(0, Number(q.priority) || 0) * 5;
      const score = waited + weightBoostMs - priorityPenaltyMs;
      if (!picked || score > picked.score) {
        picked = { queue: q, index, score };
      }
    }
    if (starving) return { queue: starving.queue, starved: true, index: starving.index };
    return picked ? { queue: picked.queue, starved: false, index: picked.index } : null;
  };

  const pump = () => {
    if (shuttingDown) return;
    while (true) {
      maybeAdaptTokens();
      const pick = pickNextQueue();
      if (!pick) return;
      const { queue, starved, index } = pick;
      const next = queue.pending[index];
      if (!next || !canStart(queue, next.tokens)) return;
      queue.pending.splice(index, 1);
      queue.pendingBytes = Math.max(0, normalizeByteCount(queue.pendingBytes) - normalizeByteCount(next.bytes));
      queue.running += 1;
      queue.stats.started += 1;
      counters.started += 1;
      if (starved) {
        queue.stats.starvation += 1;
        counters.starvation += 1;
      }
      const used = reserve(queue, next.tokens);
      const done = Promise.resolve()
        .then(next.fn)
        .then(
          (value) => {
            queue.stats.completed += 1;
            counters.completed += 1;
            next.resolve(value);
          },
          (err) => {
            queue.stats.failed += 1;
            counters.failed += 1;
            next.reject(err);
          }
        )
        .finally(() => {
          queue.running -= 1;
          release(queue, used);
          pump();
        });
      void done;
    }
  };

  const schedule = (queueName, tokensReq = { cpu: 1 }, fn) => {
    if (typeof tokensReq === 'function') {
      fn = tokensReq;
      tokensReq = { cpu: 1 };
    }
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('schedule requires a function'));
    }
    if (!enabled || lowResourceMode) {
      return Promise.resolve().then(fn);
    }
    if (shuttingDown) {
      counters.rejected += 1;
      counters.rejectedByReason.shutdown += 1;
      return Promise.reject(new Error('scheduler is shut down'));
    }
    const normalizedReq = normalizeRequest(tokensReq || {});
    const queue = ensureQueue(queueName);
    if (queue.maxPending && queue.pending.length >= queue.maxPending) {
      queue.stats.rejected += 1;
      queue.stats.rejectedMaxPending += 1;
      queue.stats.scheduled += 1;
      counters.scheduled += 1;
      counters.rejected += 1;
      counters.rejectedByReason.maxPending += 1;
      return Promise.reject(new Error(`queue ${queueName} is at maxPending`));
    }
    if (queue.maxPendingBytes && normalizedReq.bytes > 0) {
      const pendingBytes = normalizeByteCount(queue.pendingBytes);
      const nextPendingBytes = pendingBytes + normalizedReq.bytes;
      const oversizeSingle = pendingBytes === 0 && queue.pending.length === 0;
      if (!oversizeSingle && nextPendingBytes > queue.maxPendingBytes) {
        queue.stats.rejected += 1;
        queue.stats.rejectedMaxPendingBytes += 1;
        queue.stats.scheduled += 1;
        counters.scheduled += 1;
        counters.rejected += 1;
        counters.rejectedByReason.maxPendingBytes += 1;
        return Promise.reject(new Error(`queue ${queueName} is at maxPendingBytes`));
      }
    }
    return new Promise((resolve, reject) => {
      queue.pending.push({
        tokens: normalizedReq,
        bytes: normalizedReq.bytes,
        fn,
        resolve,
        reject,
        enqueuedAt: nowMs()
      });
      queue.pendingBytes = normalizeByteCount(queue.pendingBytes) + normalizedReq.bytes;
      maybeAdaptTokens();
      queue.stats.scheduled += 1;
      counters.scheduled += 1;
      captureTelemetryIfDue('schedule');
      pump();
    });
  };

  const clearQueue = (queueName, reason = 'scheduler queue cleared') => {
    const queue = queues.get(queueName);
    if (!queue || !queue.pending.length) return 0;
    const error = new Error(reason);
    const cleared = queue.pending.splice(0, queue.pending.length);
    let clearedBytes = 0;
    for (const item of cleared) {
      clearedBytes += normalizeByteCount(item?.bytes);
      queue.stats.rejected += 1;
      counters.rejected += 1;
      counters.rejectedByReason.cleared += 1;
      try {
        item.reject(error);
      } catch {}
    }
    queue.pendingBytes = Math.max(0, normalizeByteCount(queue.pendingBytes) - clearedBytes);
    return cleared.length;
  };

  const stats = () => {
    captureTelemetryIfDue('stats');
    const queueStats = {};
    let totalPending = 0;
    let totalPendingBytes = 0;
    let totalRunning = 0;
    let totalInFlightBytesValue = 0;
    for (const q of queueOrder) {
      const oldest = q.pending.length ? nowMs() - q.pending[0].enqueuedAt : 0;
      totalPending += q.pending.length;
      totalPendingBytes += normalizeByteCount(q.pendingBytes);
      totalRunning += q.running;
      totalInFlightBytesValue += normalizeByteCount(q.inFlightBytes);
      queueStats[q.name] = {
        pending: q.pending.length,
        pendingBytes: normalizeByteCount(q.pendingBytes),
        running: q.running,
        inFlightBytes: normalizeByteCount(q.inFlightBytes),
        maxPending: q.maxPending,
        maxPendingBytes: q.maxPendingBytes,
        maxInFlightBytes: q.maxInFlightBytes,
        priority: q.priority,
        weight: q.weight,
        oldestWaitMs: oldest,
        scheduled: q.stats.scheduled,
        started: q.stats.started,
        completed: q.stats.completed,
        failed: q.stats.failed,
        rejected: q.stats.rejected,
        rejectedMaxPending: q.stats.rejectedMaxPending,
        rejectedMaxPendingBytes: q.stats.rejectedMaxPendingBytes,
        starvation: q.stats.starvation
      };
    }
    const resolveUtilization = (used, total) => (
      total > 0 ? Math.max(0, Math.min(1, used / total)) : 0
    );
    const cpuUtilization = resolveUtilization(tokens.cpu.used, tokens.cpu.total);
    const ioUtilization = resolveUtilization(tokens.io.used, tokens.io.total);
    const memUtilization = resolveUtilization(tokens.mem.used, tokens.mem.total);
    return {
      queues: queueStats,
      counters: {
        ...counters,
        rejectedByReason: { ...counters.rejectedByReason }
      },
      activity: {
        pending: totalPending,
        pendingBytes: totalPendingBytes,
        running: totalRunning,
        inFlightBytes: totalInFlightBytesValue
      },
      adaptive: {
        enabled: adaptiveEnabled,
        baseline: baselineLimits,
        max: maxLimits,
        targetUtilization: adaptiveTargetUtilization,
        step: adaptiveStep,
        memoryReserveMb: adaptiveMemoryReserveMb,
        memoryPerTokenMb: adaptiveMemoryPerTokenMb,
        maxInFlightBytes: globalMaxInFlightBytes,
        intervalMs: adaptiveCurrentIntervalMs,
        mode: adaptiveMode,
        smoothedUtilization: smoothedUtilization ?? 0,
        smoothedPendingPressure: smoothedPendingPressure ?? 0,
        smoothedStarvation: smoothedStarvation ?? 0
      },
      utilization: {
        cpu: cpuUtilization,
        io: ioUtilization,
        mem: memUtilization,
        overall: Math.max(cpuUtilization, ioUtilization, memUtilization)
      },
      tokens: {
        cpu: { ...tokens.cpu },
        io: { ...tokens.io },
        mem: { ...tokens.mem }
      },
      telemetry: {
        stage: telemetryStage,
        traceIntervalMs,
        queueDepthSnapshotIntervalMs,
        queueDepthSnapshotsEnabled,
        schedulingTrace: cloneTraceEntries(schedulingTrace),
        queueDepthSnapshots: cloneQueueDepthEntries(queueDepthSnapshots)
      }
    };
  };

  const shutdown = () => {
    shuttingDown = true;
    if (telemetryTimer) clearInterval(telemetryTimer);
  };

  const setLimits = (limits = {}) => {
    if (Number.isFinite(Number(limits.cpuTokens))) {
      cpuTokens = Math.max(1, Math.floor(Number(limits.cpuTokens)));
    }
    if (Number.isFinite(Number(limits.ioTokens))) {
      ioTokens = Math.max(1, Math.floor(Number(limits.ioTokens)));
    }
    if (Number.isFinite(Number(limits.memoryTokens))) {
      memoryTokens = Math.max(1, Math.floor(Number(limits.memoryTokens)));
    }
    tokens.cpu.total = cpuTokens;
    tokens.io.total = ioTokens;
    tokens.mem.total = memoryTokens;
    captureSchedulingTrace({ reason: 'set-limits', force: true });
    pump();
  };

  const setTelemetryOptions = (options = {}) => {
    if (typeof options?.stage === 'string') {
      telemetryStage = normalizeTelemetryStage(options.stage, telemetryStage);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'queueDepthSnapshotsEnabled')) {
      queueDepthSnapshotsEnabled = options.queueDepthSnapshotsEnabled === true;
    }
    if (Number.isFinite(Number(options?.traceIntervalMs))) {
      traceIntervalMs = Math.max(100, Math.floor(Number(options.traceIntervalMs)));
    }
    if (Number.isFinite(Number(options?.queueDepthSnapshotIntervalMs))) {
      queueDepthSnapshotIntervalMs = Math.max(1000, Math.floor(Number(options.queueDepthSnapshotIntervalMs)));
    }
    const now = nowMs();
    captureSchedulingTrace({ now, reason: 'telemetry-options', force: true });
    if (queueDepthSnapshotsEnabled) {
      captureQueueDepthSnapshot({ now, reason: 'telemetry-options', force: true });
    }
  };

  captureSchedulingTrace({ reason: 'init', force: true });

  return {
    schedule,
    stats,
    shutdown,
    setLimits,
    registerQueue,
    registerQueues,
    clearQueue,
    setTelemetryOptions,
    enabled,
    lowResourceMode
  };
}

/**
 * Adapt a build scheduler queue to a PQueue-like interface used by runWithQueue.
 * @param {{scheduler:ReturnType<typeof createBuildScheduler>,queueName:string,tokens?:{cpu?:number,io?:number,mem?:number},maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number}} input
 * @returns {{add:(fn:()=>Promise<any>,options?:{bytes?:number})=>Promise<any>,onIdle:()=>Promise<void>,clear:()=>void,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number}}
 */
export function createSchedulerQueueAdapter({
  scheduler,
  queueName,
  tokens,
  maxPending,
  maxPendingBytes,
  maxInFlightBytes,
  concurrency
}) {
  if (!scheduler || typeof scheduler.schedule !== 'function') {
    throw new Error('Scheduler queue adapter requires a scheduler instance.');
  }
  if (!queueName) {
    throw new Error('Scheduler queue adapter requires a queue name.');
  }
  scheduler.registerQueue?.(queueName, {
    ...(Number.isFinite(Number(maxPending)) ? { maxPending: Math.max(1, Math.floor(Number(maxPending))) } : {}),
    ...(Number.isFinite(Number(maxPendingBytes))
      ? { maxPendingBytes: Math.max(1, Math.floor(Number(maxPendingBytes))) }
      : {}),
    ...(Number.isFinite(Number(maxInFlightBytes))
      ? { maxInFlightBytes: Math.max(1, Math.floor(Number(maxInFlightBytes))) }
      : {})
  });
  const pending = new Set();
  let idleResolvers = [];
  const notifyIdle = () => {
    if (pending.size !== 0) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  };
  const add = (fn, options = {}) => {
    const bytesRaw = Number(options?.bytes);
    const bytes = Number.isFinite(bytesRaw) && bytesRaw > 0 ? Math.floor(bytesRaw) : 0;
    const tokenRequest = bytes > 0
      ? { ...(tokens || { cpu: 1 }), bytes }
      : (tokens || { cpu: 1 });
    const task = scheduler.schedule(queueName, tokenRequest, fn);
    pending.add(task);
    task.finally(() => {
      pending.delete(task);
      notifyIdle();
    }).catch(() => {});
    return task;
  };
  const onIdle = () => {
    if (pending.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      idleResolvers.push(resolve);
    });
  };
  const clear = () => {
    scheduler.clearQueue?.(queueName, 'scheduler queue cleared');
  };
  return {
    add,
    onIdle,
    clear,
    maxPending: Number.isFinite(Number(maxPending)) ? Math.floor(Number(maxPending)) : undefined,
    maxPendingBytes: Number.isFinite(Number(maxPendingBytes))
      ? Math.floor(Number(maxPendingBytes))
      : undefined,
    maxInFlightBytes: Number.isFinite(Number(maxInFlightBytes))
      ? Math.floor(Number(maxInFlightBytes))
      : undefined,
    concurrency: Number.isFinite(Number(concurrency)) ? Math.floor(Number(concurrency)) : undefined
  };
}
