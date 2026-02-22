import PQueue from 'p-queue';
import os from 'node:os';
import { createAbortError, throwIfAborted } from './abort.js';
import { coerceUnitFraction } from './number-coerce.js';

const ADAPTIVE_SURFACE_KEYS = Object.freeze([
  'parse',
  'inference',
  'artifactWrite',
  'sqlite',
  'embeddings'
]);

const DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP = Object.freeze({
  'stage1.cpu': 'parse',
  'stage1.io': 'parse',
  'stage1.proc': 'parse',
  'stage1.postings': 'parse',
  'stage2.relations': 'inference',
  'stage2.relations.io': 'inference',
  'stage2.write': 'artifactWrite',
  'stage4.sqlite': 'sqlite',
  'embeddings.compute': 'embeddings',
  'embeddings.io': 'embeddings'
});

const DEFAULT_ADAPTIVE_SURFACE_POLICY = Object.freeze({
  parse: Object.freeze({
    targetUtilization: 0.88,
    upBacklogPerSlot: 1.2,
    downBacklogPerSlot: 0.35,
    upWaitMs: 1200,
    downWaitMs: 120,
    upCooldownMs: 500,
    downCooldownMs: 1400,
    oscillationGuardMs: 1200,
    ioPressureThreshold: 0.95,
    memoryPressureThreshold: 0.92,
    gcPressureThreshold: 0.35
  }),
  inference: Object.freeze({
    targetUtilization: 0.84,
    upBacklogPerSlot: 1.3,
    downBacklogPerSlot: 0.3,
    upWaitMs: 1500,
    downWaitMs: 160,
    upCooldownMs: 600,
    downCooldownMs: 1500,
    oscillationGuardMs: 1300,
    ioPressureThreshold: 0.9,
    memoryPressureThreshold: 0.9,
    gcPressureThreshold: 0.3
  }),
  artifactWrite: Object.freeze({
    targetUtilization: 0.76,
    upBacklogPerSlot: 1.4,
    downBacklogPerSlot: 0.25,
    upWaitMs: 1800,
    downWaitMs: 220,
    upCooldownMs: 700,
    downCooldownMs: 1800,
    oscillationGuardMs: 1500,
    ioPressureThreshold: 0.72,
    memoryPressureThreshold: 0.88,
    gcPressureThreshold: 0.25
  }),
  sqlite: Object.freeze({
    targetUtilization: 0.74,
    upBacklogPerSlot: 1.15,
    downBacklogPerSlot: 0.2,
    upWaitMs: 1000,
    downWaitMs: 100,
    upCooldownMs: 500,
    downCooldownMs: 1700,
    oscillationGuardMs: 1400,
    ioPressureThreshold: 0.75,
    memoryPressureThreshold: 0.87,
    gcPressureThreshold: 0.25
  }),
  embeddings: Object.freeze({
    targetUtilization: 0.8,
    upBacklogPerSlot: 1.35,
    downBacklogPerSlot: 0.3,
    upWaitMs: 1600,
    downWaitMs: 180,
    upCooldownMs: 650,
    downCooldownMs: 1600,
    oscillationGuardMs: 1350,
    ioPressureThreshold: 0.8,
    memoryPressureThreshold: 0.9,
    gcPressureThreshold: 0.3
  })
});

/**
 * Create shared task queues for IO, CPU, and embeddings work.
 * @param {{ioConcurrency:number,cpuConcurrency:number,embeddingConcurrency?:number,procConcurrency?:number,ioPendingLimit?:number,cpuPendingLimit?:number,embeddingPendingLimit?:number,procPendingLimit?:number,ioPendingBytesLimit?:number,cpuPendingBytesLimit?:number,embeddingPendingBytesLimit?:number,procPendingBytesLimit?:number}} input
 * @returns {{io:PQueue,cpu:PQueue,embedding:PQueue|null,proc?:PQueue}}
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
  const embeddingConcurrencyRaw = Number(embeddingConcurrency);
  const embeddingLimit = Number.isFinite(embeddingConcurrencyRaw)
    ? Math.floor(embeddingConcurrencyRaw)
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const embedding = embeddingLimit > 0
    ? new PQueue({ concurrency: embeddingLimit })
    : null;
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
  if (embedding) applyLimit(embedding, embeddingPendingLimit);
  applyBytesLimit(io, ioPendingBytesLimit);
  applyBytesLimit(cpu, cpuPendingBytesLimit);
  if (embedding) applyBytesLimit(embedding, embeddingPendingBytesLimit);
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
        if (err?.retryable === false) throw err;
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
  const waitForPendingDrainOrAbort = async () => {
    if (!pendingSignals.size) return;
    const pendingDrain = Promise.all(Array.from(pendingSignals));
    if (!signal) {
      await pendingDrain;
      return;
    }
    if (signal.aborted) {
      throw abortError;
    }
    let onAbort = null;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(abortError);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([pendingDrain, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted && !bestEffort) break;
    }
    await waitForPendingDrainOrAbort();
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
 * @param {{enabled?:boolean,lowResourceMode?:boolean,cpuTokens?:number,ioTokens?:number,memoryTokens?:number,starvationMs?:number,maxInFlightBytes?:number,queues?:Record<string,{priority?:number,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number}>,traceMaxSamples?:number,queueDepthSnapshotMaxSamples?:number,traceIntervalMs?:number,queueDepthSnapshotIntervalMs?:number,queueDepthSnapshotsEnabled?:boolean,writeBackpressure?:{enabled?:boolean,writeQueue?:string,producerQueues?:string[],pendingThreshold?:number,pendingBytesThreshold?:number,oldestWaitMsThreshold?:number}}} input
 * @returns {{schedule:(queueName:string,tokens?:{cpu?:number,io?:number,mem?:number,bytes?:number},fn?:()=>Promise<any>)=>Promise<any>,stats:()=>any,shutdown:()=>void,setLimits:(limits:{cpuTokens?:number,ioTokens?:number,memoryTokens?:number})=>void,setTelemetryOptions:(options:{stage?:string,queueDepthSnapshotsEnabled?:boolean,queueDepthSnapshotIntervalMs?:number,traceIntervalMs?:number})=>void}}
 */
export function createBuildScheduler(input = {}) {
  const enabled = input.enabled !== false;
  const lowResourceMode = input.lowResourceMode === true;
  const starvationMs = Number.isFinite(Number(input.starvationMs))
    ? Math.max(0, Math.floor(Number(input.starvationMs)))
    : 30000;
  const WAIT_TIME_SAMPLE_LIMIT = 64;
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
  const resolvePercentile = (values, ratio) => {
    if (!Array.isArray(values) || !values.length) return 0;
    const normalized = values
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry >= 0)
      .sort((a, b) => a - b);
    if (!normalized.length) return 0;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const index = Math.min(normalized.length - 1, Math.max(0, Math.ceil(normalized.length * clamped) - 1));
    return normalized[index];
  };
  const normalizeSurfaceName = (value) => (
    typeof value === 'string' && value.trim() ? value.trim() : null
  );
  const normalizePositiveInt = (value, fallback) => {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };
  const normalizeNonNegativeInt = (value, fallback) => {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  };
  const normalizeRatio = (value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  const normalizeCooldownMs = (value, fallback = 0) => (
    Math.max(0, normalizeNonNegativeInt(value, fallback) ?? fallback)
  );
  const normalizeBacklogRatio = (value, fallback, min = 0) => (
    Math.max(min, normalizeRatio(value, fallback, { min, max: 64 }) ?? fallback)
  );
  const nowInput = typeof input.now === 'function' ? input.now : null;
  const nowMs = () => {
    if (!nowInput) return Date.now();
    const value = Number(nowInput());
    return Number.isFinite(value) ? value : Date.now();
  };
  const isObject = (value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  );
  const resolveSurfaceDefaultBounds = (surfaceName) => {
    const cpuHeadroom = Math.max(1, maxLimits.cpu);
    const ioHeadroom = Math.max(1, maxLimits.io);
    switch (surfaceName) {
      case 'parse':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.9)),
          initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75))
        };
      case 'inference':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.75)),
          initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.5))
        };
      case 'artifactWrite':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.85)),
          initialConcurrency: Math.max(1, Math.ceil(ioHeadroom * 0.6))
        };
      case 'sqlite': {
        const sharedCap = Math.max(1, Math.min(cpuHeadroom, ioHeadroom));
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(sharedCap * 0.6)),
          initialConcurrency: Math.max(1, Math.ceil(sharedCap * 0.5))
        };
      }
      case 'embeddings':
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.8)),
          initialConcurrency: Math.max(1, Math.ceil(cpuHeadroom * 0.55))
        };
      default:
        return {
          minConcurrency: 1,
          maxConcurrency: Math.max(1, cpuHeadroom),
          initialConcurrency: 1
        };
    }
  };
  const adaptiveSurfaceRoot = isObject(input.adaptiveSurfaces)
    ? input.adaptiveSurfaces
    : {};
  const adaptiveSurfaceConfig = isObject(adaptiveSurfaceRoot.surfaces)
    ? adaptiveSurfaceRoot.surfaces
    : adaptiveSurfaceRoot;
  const adaptiveSurfaceControllersEnabled = adaptiveEnabled
    && adaptiveSurfaceRoot.enabled !== false;
  const adaptiveSurfaceDecisionTraceMax = normalizePositiveInt(
    adaptiveSurfaceRoot.decisionTraceMaxSamples
      ?? input.adaptiveDecisionTraceMaxSamples,
    512
  ) || 512;
  const adaptiveDecisionTrace = [];
  let adaptiveDecisionId = 0;
  const appendAdaptiveDecision = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    adaptiveDecisionTrace.push(entry);
    while (adaptiveDecisionTrace.length > adaptiveSurfaceDecisionTraceMax) {
      adaptiveDecisionTrace.shift();
    }
  };
  const surfaceQueueMap = new Map(Object.entries(DEFAULT_ADAPTIVE_SURFACE_QUEUE_MAP));
  const adaptiveSurfaceStates = new Map();
  for (const surfaceName of ADAPTIVE_SURFACE_KEYS) {
    const defaults = DEFAULT_ADAPTIVE_SURFACE_POLICY[surfaceName]
      || DEFAULT_ADAPTIVE_SURFACE_POLICY.parse;
    const bounds = resolveSurfaceDefaultBounds(surfaceName);
    const config = isObject(adaptiveSurfaceConfig?.[surfaceName])
      ? adaptiveSurfaceConfig[surfaceName]
      : {};
    const explicitQueues = Array.isArray(config.queues)
      ? config.queues
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
      : [];
    if (explicitQueues.length) {
      for (const queueName of explicitQueues) {
        surfaceQueueMap.set(queueName, surfaceName);
      }
    }
    const minConcurrency = Math.max(
      1,
      normalizePositiveInt(config.minConcurrency, bounds.minConcurrency) || bounds.minConcurrency
    );
    const maxConcurrency = Math.max(
      minConcurrency,
      normalizePositiveInt(config.maxConcurrency, bounds.maxConcurrency) || bounds.maxConcurrency
    );
    const initialConcurrency = Math.max(
      minConcurrency,
      Math.min(
        maxConcurrency,
        normalizePositiveInt(config.initialConcurrency, bounds.initialConcurrency)
          || bounds.initialConcurrency
      )
    );
    adaptiveSurfaceStates.set(surfaceName, {
      name: surfaceName,
      minConcurrency,
      maxConcurrency,
      currentConcurrency: initialConcurrency,
      upBacklogPerSlot: normalizeBacklogRatio(
        config.upBacklogPerSlot,
        defaults.upBacklogPerSlot,
        0.1
      ),
      downBacklogPerSlot: normalizeBacklogRatio(
        config.downBacklogPerSlot,
        defaults.downBacklogPerSlot,
        0
      ),
      upWaitMs: normalizeCooldownMs(config.upWaitMs, defaults.upWaitMs),
      downWaitMs: normalizeCooldownMs(config.downWaitMs, defaults.downWaitMs),
      upCooldownMs: normalizeCooldownMs(config.upCooldownMs, defaults.upCooldownMs),
      downCooldownMs: normalizeCooldownMs(config.downCooldownMs, defaults.downCooldownMs),
      oscillationGuardMs: normalizeCooldownMs(
        config.oscillationGuardMs,
        defaults.oscillationGuardMs
      ),
      targetUtilization: coerceUnitFraction(config.targetUtilization)
        ?? defaults.targetUtilization,
      ioPressureThreshold: normalizeRatio(
        config.ioPressureThreshold,
        defaults.ioPressureThreshold,
        { min: 0, max: 1 }
      ),
      memoryPressureThreshold: normalizeRatio(
        config.memoryPressureThreshold,
        defaults.memoryPressureThreshold,
        { min: 0, max: 1 }
      ),
      gcPressureThreshold: normalizeRatio(
        config.gcPressureThreshold,
        defaults.gcPressureThreshold,
        { min: 0, max: 1 }
      ),
      lastScaleUpAt: Number.NEGATIVE_INFINITY,
      lastScaleDownAt: Number.NEGATIVE_INFINITY,
      lastDecisionAt: 0,
      lastAction: 'hold',
      decisions: {
        up: 0,
        down: 0,
        hold: 0
      },
      lastDecision: null
    });
  }
  const resolveQueueSurface = (queueName, explicitSurface = null) => {
    const explicit = normalizeSurfaceName(explicitSurface);
    if (explicit && adaptiveSurfaceStates.has(explicit)) return explicit;
    const mapped = normalizeSurfaceName(surfaceQueueMap.get(queueName));
    if (mapped && adaptiveSurfaceStates.has(mapped)) return mapped;
    return null;
  };
  let lastMemorySignals = null;
  let lastSystemSignals = null;

  const queueConfig = input.queues || {};
  const queues = new Map();
  const queueOrder = [];
  const normalizeQueueName = (value) => (
    typeof value === 'string' && value.trim() ? value.trim() : null
  );
  const writeBackpressureInput = input.writeBackpressure
    && typeof input.writeBackpressure === 'object'
    ? input.writeBackpressure
    : null;
  const writeBackpressure = {
    enabled: writeBackpressureInput?.enabled !== false,
    writeQueue: normalizeQueueName(writeBackpressureInput?.writeQueue) || 'stage2.write',
    producerQueues: new Set(
      Array.isArray(writeBackpressureInput?.producerQueues)
        ? writeBackpressureInput.producerQueues
          .map((entry) => normalizeQueueName(entry))
          .filter(Boolean)
        : ['stage1.cpu', 'stage1.io', 'stage1.postings', 'stage2.relations', 'stage2.relations.io']
    ),
    pendingThreshold: Number.isFinite(Number(writeBackpressureInput?.pendingThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.pendingThreshold)))
      : 128,
    pendingBytesThreshold: Number.isFinite(Number(writeBackpressureInput?.pendingBytesThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.pendingBytesThreshold)))
      : (256 * 1024 * 1024),
    oldestWaitMsThreshold: Number.isFinite(Number(writeBackpressureInput?.oldestWaitMsThreshold))
      ? Math.max(1, Math.floor(Number(writeBackpressureInput.oldestWaitMsThreshold)))
      : 15000
  };
  const writeBackpressureState = {
    active: false,
    reasons: [],
    queue: writeBackpressure.writeQueue,
    pending: 0,
    pendingBytes: 0,
    oldestWaitMs: 0
  };
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
    const surface = resolveQueueSurface(name, cfg?.surface);
    const state = {
      name,
      surface,
      priority: Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 50,
      weight: Number.isFinite(Number(cfg.weight)) ? Math.max(1, Math.floor(Number(cfg.weight))) : 1,
      floorCpu: Number.isFinite(Number(cfg.floorCpu)) ? Math.max(0, Math.floor(Number(cfg.floorCpu))) : 0,
      floorIo: Number.isFinite(Number(cfg.floorIo)) ? Math.max(0, Math.floor(Number(cfg.floorIo))) : 0,
      floorMem: Number.isFinite(Number(cfg.floorMem)) ? Math.max(0, Math.floor(Number(cfg.floorMem))) : 0,
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
        lastWaitMs: 0,
        waitP95Ms: 0,
        waitSamples: [],
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
    if (Number.isFinite(Number(config.floorCpu))) {
      queue.floorCpu = Math.max(0, Math.floor(Number(config.floorCpu)));
    }
    if (Number.isFinite(Number(config.floorIo))) {
      queue.floorIo = Math.max(0, Math.floor(Number(config.floorIo)));
    }
    if (Number.isFinite(Number(config.floorMem))) {
      queue.floorMem = Math.max(0, Math.floor(Number(config.floorMem)));
    }
    if (Object.prototype.hasOwnProperty.call(config, 'surface')) {
      queue.surface = resolveQueueSurface(queue.name, config.surface);
    }
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  };

  const evaluateWriteBackpressure = () => {
    if (!writeBackpressure.enabled) {
      writeBackpressureState.active = false;
      writeBackpressureState.reasons = [];
      writeBackpressureState.pending = 0;
      writeBackpressureState.pendingBytes = 0;
      writeBackpressureState.oldestWaitMs = 0;
      return writeBackpressureState;
    }
    const writeQueue = queues.get(writeBackpressure.writeQueue);
    if (!writeQueue) {
      writeBackpressureState.active = false;
      writeBackpressureState.reasons = [];
      writeBackpressureState.pending = 0;
      writeBackpressureState.pendingBytes = 0;
      writeBackpressureState.oldestWaitMs = 0;
      return writeBackpressureState;
    }
    const pending = writeQueue.pending.length;
    const pendingBytes = normalizeByteCount(writeQueue.pendingBytes);
    const oldestWaitMs = pending > 0
      ? Math.max(0, nowMs() - Number(writeQueue.pending[0]?.enqueuedAt || nowMs()))
      : 0;
    const reasons = [];
    if (pending >= writeBackpressure.pendingThreshold) reasons.push('pending');
    if (pendingBytes >= writeBackpressure.pendingBytesThreshold) reasons.push('pendingBytes');
    if (oldestWaitMs >= writeBackpressure.oldestWaitMsThreshold) reasons.push('oldestWaitMs');
    writeBackpressureState.active = reasons.length > 0;
    writeBackpressureState.reasons = reasons;
    writeBackpressureState.pending = pending;
    writeBackpressureState.pendingBytes = pendingBytes;
    writeBackpressureState.oldestWaitMs = oldestWaitMs;
    return writeBackpressureState;
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

  const recordQueueWaitTime = (queue, waitedMs) => {
    if (!queue?.stats) return;
    const normalized = Math.max(0, Math.floor(Number(waitedMs) || 0));
    queue.stats.lastWaitMs = normalized;
    const samples = Array.isArray(queue.stats.waitSamples)
      ? queue.stats.waitSamples
      : [];
    samples.push(normalized);
    while (samples.length > WAIT_TIME_SAMPLE_LIMIT) samples.shift();
    queue.stats.waitSamples = samples;
    queue.stats.waitP95Ms = resolvePercentile(samples, 0.95);
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
      backpressure: {
        ...evaluateWriteBackpressure(),
        reasons: Array.from(writeBackpressureState.reasons || [])
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

  const buildAdaptiveSurfaceSnapshotByName = (surfaceName, at = nowMs()) => {
    const state = adaptiveSurfaceStates.get(surfaceName);
    if (!state) return null;
    const snapshot = {
      surface: surfaceName,
      pending: 0,
      pendingBytes: 0,
      running: 0,
      inFlightBytes: 0,
      oldestWaitMs: 0,
      ioPending: 0,
      ioPendingBytes: 0,
      ioWaitP95Ms: 0,
      queues: []
    };
    for (const queue of queueOrder) {
      if (queue?.surface !== surfaceName) continue;
      const pending = Math.max(0, queue.pending.length);
      const pendingBytes = normalizeByteCount(queue.pendingBytes);
      const running = Math.max(0, queue.running);
      const inFlightBytes = normalizeByteCount(queue.inFlightBytes);
      const oldestWaitMs = pending > 0
        ? Math.max(0, at - Number(queue.pending[0]?.enqueuedAt || at))
        : 0;
      const waitP95Ms = Math.max(0, Number(queue?.stats?.waitP95Ms) || 0);
      snapshot.pending += pending;
      snapshot.pendingBytes += pendingBytes;
      snapshot.running += running;
      snapshot.inFlightBytes += inFlightBytes;
      snapshot.oldestWaitMs = Math.max(snapshot.oldestWaitMs, oldestWaitMs);
      if ((pendingBytes > 0) || queue.name.includes('.io') || queue.name.includes('write') || queue.name.includes('sqlite')) {
        snapshot.ioPending += pending;
        snapshot.ioPendingBytes += pendingBytes;
        snapshot.ioWaitP95Ms = Math.max(snapshot.ioWaitP95Ms, waitP95Ms);
      }
      snapshot.queues.push({
        name: queue.name,
        pending,
        pendingBytes,
        running,
        inFlightBytes,
        oldestWaitMs,
        waitP95Ms
      });
    }
    snapshot.backlogPerSlot = snapshot.pending / Math.max(1, state.currentConcurrency);
    const ioPressureByBytes = snapshot.ioPendingBytes / Math.max(1, 256 * 1024 * 1024);
    const ioPressureByWait = snapshot.ioWaitP95Ms / 10000;
    snapshot.ioPressureScore = Math.max(
      0,
      Math.min(
        1.5,
        Math.max(
          snapshot.ioPending > 0 ? (snapshot.ioPending / Math.max(1, state.currentConcurrency * 2)) : 0,
          ioPressureByBytes,
          ioPressureByWait
        )
      )
    );
    return snapshot;
  };

  const buildAdaptiveSurfaceSnapshots = (at = nowMs()) => {
    const out = {};
    for (const surfaceName of adaptiveSurfaceStates.keys()) {
      out[surfaceName] = buildAdaptiveSurfaceSnapshotByName(surfaceName, at);
    }
    return out;
  };

  const readSystemSignals = (at = nowMs()) => {
    const cpuTokenUtilization = tokens.cpu.total > 0 ? (tokens.cpu.used / tokens.cpu.total) : 0;
    const ioTokenUtilization = tokens.io.total > 0 ? (tokens.io.used / tokens.io.total) : 0;
    const memTokenUtilization = tokens.mem.total > 0 ? (tokens.mem.used / tokens.mem.total) : 0;
    const defaultSignals = {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio: 0
      },
      memory: {
        rssBytes: 0,
        heapUsedBytes: 0,
        heapTotalBytes: 0,
        freeBytes: 0,
        totalBytes: 0,
        rssUtilization: null,
        heapUtilization: null,
        freeRatio: null,
        pressureScore: Math.max(memTokenUtilization, 0),
        gcPressureScore: 0
      }
    };
    if (typeof input.adaptiveSignalSampler === 'function') {
      try {
        const sampled = input.adaptiveSignalSampler({
          at,
          stage: telemetryStage,
          tokens: cloneTokenState()
        });
        if (sampled && typeof sampled === 'object') {
          const cpuToken = normalizeRatio(
            sampled?.cpu?.tokenUtilization,
            defaultSignals.cpu.tokenUtilization,
            { min: 0, max: 1.5 }
          );
          const cpuLoad = normalizeRatio(sampled?.cpu?.loadRatio, defaultSignals.cpu.loadRatio, { min: 0, max: 2 });
          const pressureScore = normalizeRatio(
            sampled?.memory?.pressureScore,
            defaultSignals.memory.pressureScore,
            { min: 0, max: 2 }
          );
          const gcPressureScore = normalizeRatio(
            sampled?.memory?.gcPressureScore,
            defaultSignals.memory.gcPressureScore,
            { min: 0, max: 2 }
          );
          defaultSignals.cpu = {
            tokenUtilization: cpuToken,
            loadRatio: cpuLoad
          };
          defaultSignals.memory = {
            ...defaultSignals.memory,
            pressureScore,
            gcPressureScore,
            rssBytes: normalizeNonNegativeInt(sampled?.memory?.rssBytes, defaultSignals.memory.rssBytes),
            heapUsedBytes: normalizeNonNegativeInt(sampled?.memory?.heapUsedBytes, defaultSignals.memory.heapUsedBytes),
            heapTotalBytes: normalizeNonNegativeInt(sampled?.memory?.heapTotalBytes, defaultSignals.memory.heapTotalBytes),
            freeBytes: normalizeNonNegativeInt(sampled?.memory?.freeBytes, defaultSignals.memory.freeBytes),
            totalBytes: normalizeNonNegativeInt(sampled?.memory?.totalBytes, defaultSignals.memory.totalBytes),
            rssUtilization: normalizeRatio(sampled?.memory?.rssUtilization, defaultSignals.memory.rssUtilization, { min: 0, max: 1 }),
            heapUtilization: normalizeRatio(sampled?.memory?.heapUtilization, defaultSignals.memory.heapUtilization, { min: 0, max: 1 }),
            freeRatio: normalizeRatio(sampled?.memory?.freeRatio, defaultSignals.memory.freeRatio, { min: 0, max: 1 })
          };
          return defaultSignals;
        }
      } catch {}
    }
    const cpuCount = typeof os.availableParallelism === 'function'
      ? Math.max(1, os.availableParallelism())
      : Math.max(1, os.cpus().length || 1);
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const loadRatio = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) && cpuCount > 0
      ? Math.max(0, Math.min(2, Number(loadAvg[0]) / cpuCount))
      : 0;
    let rssBytes = 0;
    let heapUsedBytes = 0;
    let heapTotalBytes = 0;
    try {
      const usage = process.memoryUsage();
      rssBytes = Number(usage?.rss) || 0;
      heapUsedBytes = Number(usage?.heapUsed) || 0;
      heapTotalBytes = Number(usage?.heapTotal) || 0;
    } catch {}
    const totalBytes = Number(os.totalmem()) || 0;
    const freeBytes = Number(os.freemem()) || 0;
    const rssUtilization = totalBytes > 0 ? Math.max(0, Math.min(1, rssBytes / totalBytes)) : null;
    const heapUtilization = heapTotalBytes > 0 ? Math.max(0, Math.min(1, heapUsedBytes / heapTotalBytes)) : null;
    const freeRatio = totalBytes > 0 ? Math.max(0, Math.min(1, freeBytes / totalBytes)) : null;
    const freePressure = Number.isFinite(freeRatio) ? (1 - freeRatio) : 0;
    const memoryPressureScore = Math.max(
      memTokenUtilization,
      Number.isFinite(rssUtilization) ? rssUtilization : 0,
      Number.isFinite(heapUtilization) ? heapUtilization : 0,
      freePressure
    );
    let gcPressureScore = 0;
    if (lastMemorySignals && Number(lastMemorySignals.heapUsedBytes) > 0) {
      const priorHeap = Number(lastMemorySignals.heapUsedBytes) || 0;
      const delta = priorHeap - heapUsedBytes;
      if (delta > 0) {
        gcPressureScore = Math.max(0, Math.min(1, delta / Math.max(1, priorHeap)));
      }
    }
    lastMemorySignals = { heapUsedBytes };
    return {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio
      },
      memory: {
        rssBytes,
        heapUsedBytes,
        heapTotalBytes,
        freeBytes,
        totalBytes,
        rssUtilization,
        heapUtilization,
        freeRatio,
        pressureScore: memoryPressureScore,
        gcPressureScore
      }
    };
  };

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

  const countSurfaceRunning = (surfaceName) => {
    if (!surfaceName) return 0;
    let total = 0;
    for (const queue of queueOrder) {
      if (queue?.surface !== surfaceName) continue;
      total += Math.max(0, Number(queue?.running) || 0);
    }
    return total;
  };

  const cloneDecisionEntry = (entry) => ({
    ...(entry && typeof entry === 'object' ? entry : {}),
    snapshot: entry?.snapshot && typeof entry.snapshot === 'object'
      ? { ...entry.snapshot }
      : null,
    signals: entry?.signals && typeof entry.signals === 'object'
      ? {
        cpu: entry.signals.cpu && typeof entry.signals.cpu === 'object'
          ? { ...entry.signals.cpu }
          : null,
        memory: entry.signals.memory && typeof entry.signals.memory === 'object'
          ? { ...entry.signals.memory }
          : null
      }
      : null
  });

  const maybeAdaptSurfaceControllers = (now) => {
    if (!adaptiveSurfaceControllersEnabled) return;
    const at = Number.isFinite(Number(now)) ? Number(now) : nowMs();
    const snapshots = buildAdaptiveSurfaceSnapshots(at);
    const signals = readSystemSignals(at);
    lastSystemSignals = signals;
    for (const [surfaceName, state] of adaptiveSurfaceStates.entries()) {
      const snapshot = snapshots[surfaceName];
      if (!snapshot) continue;
      const previousConcurrency = state.currentConcurrency;
      const running = Math.max(
        Math.max(0, Number(snapshot.running) || 0),
        countSurfaceRunning(surfaceName)
      );
      const backlogPerSlot = Math.max(0, Number(snapshot.backlogPerSlot) || 0);
      const oldestWaitMs = Math.max(0, Number(snapshot.oldestWaitMs) || 0);
      const ioPressureScore = Math.max(0, Number(snapshot.ioPressureScore) || 0);
      const cpuUtilization = Math.max(
        0,
        Number(signals?.cpu?.tokenUtilization) || 0,
        Number(signals?.cpu?.loadRatio) || 0
      );
      const memoryPressure = Math.max(0, Number(signals?.memory?.pressureScore) || 0);
      const gcPressure = Math.max(0, Number(signals?.memory?.gcPressureScore) || 0);
      let action = 'hold';
      let reason = 'steady';
      if (
        memoryPressure >= state.memoryPressureThreshold
        || gcPressure >= state.gcPressureThreshold
        || ioPressureScore >= state.ioPressureThreshold
      ) {
        action = 'down';
        reason = memoryPressure >= state.memoryPressureThreshold
          ? 'memory-pressure'
          : (gcPressure >= state.gcPressureThreshold ? 'gc-pressure' : 'io-pressure');
      } else if (
        backlogPerSlot >= state.upBacklogPerSlot
        && oldestWaitMs >= state.upWaitMs
        && cpuUtilization <= Math.max(1, state.targetUtilization + 0.15)
      ) {
        action = 'up';
        reason = 'backlog';
      } else if (
        backlogPerSlot <= state.downBacklogPerSlot
        && oldestWaitMs <= state.downWaitMs
        && running < state.currentConcurrency
      ) {
        action = 'down';
        reason = 'drain';
      }
      let nextConcurrency = state.currentConcurrency;
      if (action === 'up') {
        const inUpCooldown = (at - state.lastScaleUpAt) < state.upCooldownMs;
        const inOscillationGuard = state.lastAction === 'down'
          && (at - state.lastScaleDownAt) < state.oscillationGuardMs;
        if (
          state.currentConcurrency < state.maxConcurrency
          && !inUpCooldown
          && !inOscillationGuard
        ) {
          nextConcurrency = Math.min(state.maxConcurrency, state.currentConcurrency + 1);
        } else {
          action = 'hold';
          reason = inUpCooldown ? 'up-cooldown' : (inOscillationGuard ? 'oscillation-guard' : 'at-max');
        }
      } else if (action === 'down') {
        const inDownCooldown = (at - state.lastScaleDownAt) < state.downCooldownMs;
        const inOscillationGuard = state.lastAction === 'up'
          && (at - state.lastScaleUpAt) < state.oscillationGuardMs;
        if (
          state.currentConcurrency > state.minConcurrency
          && !inDownCooldown
          && !inOscillationGuard
        ) {
          nextConcurrency = Math.max(state.minConcurrency, state.currentConcurrency - 1);
        } else {
          action = 'hold';
          reason = inDownCooldown ? 'down-cooldown' : (inOscillationGuard ? 'oscillation-guard' : 'at-min');
        }
      }
      if (nextConcurrency !== state.currentConcurrency) {
        if (nextConcurrency > state.currentConcurrency) {
          state.lastScaleUpAt = at;
        } else {
          state.lastScaleDownAt = at;
        }
        state.currentConcurrency = nextConcurrency;
      } else {
        action = 'hold';
      }
      state.lastDecisionAt = at;
      state.lastAction = action;
      state.decisions[action] = (state.decisions[action] || 0) + 1;
      state.lastDecision = {
        at,
        action,
        reason,
        previousConcurrency,
        nextConcurrency: state.currentConcurrency,
        backlogPerSlot,
        oldestWaitMs,
        ioPressureScore,
        cpuUtilization,
        memoryPressure,
        gcPressure
      };
      adaptiveDecisionId += 1;
      appendAdaptiveDecision({
        id: adaptiveDecisionId,
        at,
        surface: surfaceName,
        action,
        reason,
        nextConcurrency: state.currentConcurrency,
        snapshot: {
          pending: snapshot.pending,
          running,
          backlogPerSlot,
          oldestWaitMs,
          ioPressureScore
        },
        signals: {
          cpu: signals?.cpu && typeof signals.cpu === 'object' ? { ...signals.cpu } : null,
          memory: signals?.memory && typeof signals.memory === 'object' ? { ...signals.memory } : null
        }
      });
    }
  };

  const maybeAdaptTokens = () => {
    if (!adaptiveEnabled || shuttingDown) return;
    const now = nowMs();
    if ((now - lastAdaptiveAt) < adaptiveCurrentIntervalMs) return;
    lastAdaptiveAt = now;
    maybeAdaptSurfaceControllers(now);
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
    let floorCpu = 0;
    let floorIo = 0;
    let floorMem = 0;
    for (const q of queueOrder) {
      if ((q.pending.length + q.running) <= 0) continue;
      floorCpu = Math.max(floorCpu, Number(q.floorCpu) || 0);
      floorIo = Math.max(floorIo, Number(q.floorIo) || 0);
      floorMem = Math.max(floorMem, Number(q.floorMem) || 0);
    }
    const cpuFloor = Math.max(baselineLimits.cpu, floorCpu);
    const ioFloor = Math.max(baselineLimits.io, floorIo);
    const memFloor = Math.max(baselineLimits.mem, floorMem);
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
      tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(
        memFloor,
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
      tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(memFloor, tokens.mem.used, tokens.mem.total - adaptiveStep);
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
      tokens.cpu.total = Math.max(cpuFloor, tokens.cpu.used, tokens.cpu.total - adaptiveStep);
      tokens.io.total = Math.max(ioFloor, tokens.io.used, tokens.io.total - adaptiveStep);
      tokens.mem.total = Math.max(memFloor, tokens.mem.used, tokens.mem.total - adaptiveStep);
    }
  };

  const canStart = (queue, req) => {
    const normalized = normalizeRequest(req);
    const backpressureState = evaluateWriteBackpressure();
    const producerBlocked = backpressureState.active
      && queue
      && queue.name !== writeBackpressure.writeQueue
      && writeBackpressure.producerQueues.has(queue.name);
    if (producerBlocked) {
      return false;
    }
    if (adaptiveSurfaceControllersEnabled && queue?.surface) {
      const surfaceState = adaptiveSurfaceStates.get(queue.surface);
      if (surfaceState) {
        const running = countSurfaceRunning(queue.surface);
        if (running >= surfaceState.currentConcurrency) {
          return false;
        }
      }
    }
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
      const waited = nowMs() - q.pending[index].enqueuedAt;
      if (waited >= starvationMs && (!starving || waited > starving.waited)) {
        starving = { queue: q, waited, index };
        continue;
      }
      const weightBoostMs = Math.max(1, Number(q.weight) || 1) * 250;
      const priorityPenaltyMs = Math.max(0, Number(q.priority) || 0) * 5;
      // Fairness aging by wait-time percentile: once a queue's current wait
      // exceeds its own p95 wait, boost the score to pull tail work forward.
      const waitP95Ms = Number(q.stats?.waitP95Ms) || 0;
      const agingBoostMs = waitP95Ms > 0 ? Math.max(0, waited - waitP95Ms) : 0;
      const score = waited + weightBoostMs + agingBoostMs - priorityPenaltyMs;
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
      recordQueueWaitTime(queue, nowMs() - next.enqueuedAt);
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
    if (!enabled) {
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
        surface: q.surface || null,
        pending: q.pending.length,
        pendingBytes: normalizeByteCount(q.pendingBytes),
        running: q.running,
        inFlightBytes: normalizeByteCount(q.inFlightBytes),
        maxPending: q.maxPending,
        maxPendingBytes: q.maxPendingBytes,
        maxInFlightBytes: q.maxInFlightBytes,
        floorCpu: q.floorCpu,
        floorIo: q.floorIo,
        floorMem: q.floorMem,
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
        starvation: q.stats.starvation,
        lastWaitMs: q.stats.lastWaitMs,
        waitP95Ms: q.stats.waitP95Ms,
        waitSampleCount: Array.isArray(q.stats.waitSamples) ? q.stats.waitSamples.length : 0
      };
    }
    const resolveUtilization = (used, total) => (
      total > 0 ? Math.max(0, Math.min(1, used / total)) : 0
    );
    const cpuUtilization = resolveUtilization(tokens.cpu.used, tokens.cpu.total);
    const ioUtilization = resolveUtilization(tokens.io.used, tokens.io.total);
    const memUtilization = resolveUtilization(tokens.mem.used, tokens.mem.total);
    const adaptiveSurfaces = {};
    for (const [surfaceName, state] of adaptiveSurfaceStates.entries()) {
      const snapshot = buildAdaptiveSurfaceSnapshotByName(surfaceName);
      adaptiveSurfaces[surfaceName] = {
        minConcurrency: state.minConcurrency,
        maxConcurrency: state.maxConcurrency,
        currentConcurrency: state.currentConcurrency,
        decisions: { ...state.decisions },
        lastAction: state.lastAction,
        lastDecisionAt: state.lastDecisionAt,
        lastDecision: state.lastDecision
          ? { ...state.lastDecision }
          : null,
        snapshot
      };
    }
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
        smoothedStarvation: smoothedStarvation ?? 0,
        surfaceControllersEnabled: adaptiveSurfaceControllersEnabled,
        surfaces: adaptiveSurfaces,
        decisionTrace: adaptiveDecisionTrace.map((entry) => cloneDecisionEntry(entry)),
        signals: lastSystemSignals && typeof lastSystemSignals === 'object'
          ? {
            cpu: lastSystemSignals.cpu && typeof lastSystemSignals.cpu === 'object'
              ? { ...lastSystemSignals.cpu }
              : null,
            memory: lastSystemSignals.memory && typeof lastSystemSignals.memory === 'object'
              ? { ...lastSystemSignals.memory }
              : null
          }
          : null,
        writeBackpressure: {
          ...evaluateWriteBackpressure(),
          producerQueues: Array.from(writeBackpressure.producerQueues)
        }
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
