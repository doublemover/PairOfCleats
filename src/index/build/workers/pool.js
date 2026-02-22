import util from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { log as defaultLog } from '../../../shared/progress.js';
import {
  incWorkerRetries,
  observeWorkerTaskDuration,
  setStageGcPressure,
  setWorkerActiveTasks,
  setWorkerGcPressure,
  setWorkerQueueDepth
} from '../../../shared/metrics.js';
import { createBoundedObjectPool } from '../../../shared/bounded-object-pool.js';
import {
  buildWorkerExecArgv,
  resolveMemoryWorkerCap,
  resolveWorkerHeapBudgetPolicy,
  resolveWorkerResourceLimits,
  shouldDownscaleWorkersForPressure
} from './config.js';
import { sanitizePoolPayload, sanitizeQuantizePayload, summarizeError } from './protocol.js';

/**
 * Build a deterministic NUMA assignment plan for worker slots.
 *
 * This is an advisory policy layer for worker-thread pools: it computes stable
 * node assignments and emits node hints in worker metadata/stats. On unsupported
 * hosts it degrades to an explicit inactive reason.
 *
 * @param {{config?:object,maxWorkers:number}} input
 * @returns {{enabled:boolean,active:boolean,reason:string|null,strategy:string,nodeCount:number,assignments:number[]}}
 */
const resolveNumaPinningPlan = ({ config, maxWorkers }) => {
  const policy = config?.numaPinning && typeof config.numaPinning === 'object'
    ? config.numaPinning
    : { enabled: false };
  if (policy.enabled !== true) {
    return {
      enabled: false,
      active: false,
      reason: 'disabled',
      strategy: 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  if (process.platform !== 'linux') {
    return {
      enabled: true,
      active: false,
      reason: 'unsupported-platform',
      strategy: policy.strategy || 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 0;
  const minCpuCores = Number.isFinite(Number(policy.minCpuCores))
    ? Math.max(1, Math.floor(Number(policy.minCpuCores)))
    : 24;
  if (!Number.isFinite(cpuCount) || cpuCount < minCpuCores) {
    return {
      enabled: true,
      active: false,
      reason: 'insufficient-cpu-cores',
      strategy: policy.strategy || 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  const requestedNodes = Number.isFinite(Number(policy.nodeCount))
    ? Math.max(1, Math.floor(Number(policy.nodeCount)))
    : null;
  const inferredNodes = Number.isFinite(cpuCount)
    ? Math.max(1, Math.floor(cpuCount / 16))
    : 1;
  const nodeCount = Math.max(1, Math.min(requestedNodes || inferredNodes, maxWorkers));
  if (nodeCount <= 1) {
    return {
      enabled: true,
      active: false,
      reason: 'single-node-topology',
      strategy: policy.strategy || 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  const strategy = policy.strategy === 'compact' ? 'compact' : 'interleave';
  const workers = Math.max(1, Math.floor(Number(maxWorkers) || 1));
  const assignments = new Array(workers);
  if (strategy === 'compact') {
    const workersPerNode = Math.max(1, Math.ceil(workers / nodeCount));
    for (let slot = 0; slot < workers; slot += 1) {
      assignments[slot] = Math.min(nodeCount - 1, Math.floor(slot / workersPerNode));
    }
  } else {
    for (let slot = 0; slot < workers; slot += 1) {
      assignments[slot] = slot % nodeCount;
    }
  }
  return {
    enabled: true,
    active: true,
    reason: null,
    strategy,
    nodeCount,
    assignments
  };
};

/**
 * Create a single indexer worker pool with crash logging, restart handling,
 * and task-level instrumentation.
 *
 * @param {object} [input]
 * @param {object} input.config
 * @param {Set<string>} [input.dictWords]
 * @param {object|null} [input.dictSharedPayload]
 * @param {object} [input.dictConfig]
 * @param {Set<string>|null} [input.codeDictWords]
 * @param {Map<string,Set<string>>|object|null} [input.codeDictWordsByLanguage]
 * @param {Set<string>|string[]|null} [input.codeDictLanguages]
 * @param {object} [input.postingsConfig]
 * @param {object} [input.treeSitterConfig]
 * @param {object|null} [input.memoryPolicy]
 * @param {object|null} [input.crashLogger]
 * @param {(line:string)=>void} [input.log]
 * @param {string} [input.stage]
 * @param {'tokenize'|'quantize'|string} [input.poolName]
 * @returns {Promise<object|null>}
 */
export async function createIndexerWorkerPool(input = {}) {
  const {
    config,
    dictWords,
    dictSharedPayload,
    dictConfig,
    codeDictWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    postingsConfig,
    treeSitterConfig,
    memoryPolicy = null,
    crashLogger = null,
    log = defaultLog,
    stage = 'stage1',
    poolName = 'tokenize'
  } = input;
  const poolLabel = typeof poolName === 'string' && poolName.trim()
    ? poolName.trim().toLowerCase()
    : 'tokenize';
  const memoryCappedMax = resolveMemoryWorkerCap(config?.maxWorkers);
  const poolConfig = Number.isFinite(memoryCappedMax) && memoryCappedMax > 0
    ? { ...config, maxWorkers: memoryCappedMax }
    : config;
  if (config?.maxWorkers && poolConfig?.maxWorkers && config.maxWorkers !== poolConfig.maxWorkers) {
    log(`Worker pool capped to ${poolConfig.maxWorkers} threads based on host memory.`);
  }
  const dictWordsForPool = poolLabel === 'quantize' ? [] : dictWords;
  const dictSharedForPool = poolLabel === 'quantize' ? null : dictSharedPayload;
  const codeDictWordsForPool = poolLabel === 'quantize' ? null : codeDictWords;
  const codeDictWordsByLanguageForPool = poolLabel === 'quantize' ? null : codeDictWordsByLanguage;
  const codeDictLanguagesForPool = poolLabel === 'quantize' ? null : codeDictLanguages;
  const sanitizeDictConfig = (raw) => {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    return {
      segmentation: typeof cfg.segmentation === 'string' ? cfg.segmentation : 'auto',
      dpMaxTokenLength: Number.isFinite(Number(cfg.dpMaxTokenLength))
        ? Number(cfg.dpMaxTokenLength)
        : 32
    };
  };
  const sanitizeTreeSitterConfig = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const maxBytes = Number(raw.maxBytes);
    const maxLines = Number(raw.maxLines);
    const maxParseMs = Number(raw.maxParseMs);
    return {
      enabled: raw.enabled !== false,
      languages: raw.languages && typeof raw.languages === 'object' ? raw.languages : {},
      allowedLanguages: Array.isArray(raw.allowedLanguages)
        ? raw.allowedLanguages.filter((entry) => typeof entry === 'string')
        : undefined,
      maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : null,
      maxLines: Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : null,
      maxParseMs: Number.isFinite(maxParseMs) && maxParseMs > 0 ? Math.floor(maxParseMs) : null,
      byLanguage: raw.byLanguage && typeof raw.byLanguage === 'object' ? raw.byLanguage : {}
    };
  };
  function *iterateStringEntries(value) {
    if (!value) return;
    if (typeof value === 'string') {
      yield value;
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') yield entry;
      }
      return;
    }
    if (value instanceof Set) {
      for (const entry of value.values()) {
        if (typeof entry === 'string') yield entry;
      }
      return;
    }
    if (typeof value[Symbol.iterator] === 'function') {
      for (const entry of value) {
        if (typeof entry === 'string') yield entry;
      }
    }
  }
  const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) {
      return Array.from(iterateStringEntries(value));
    }
    // Fast path: avoid large array copies when the input is already string-only.
    for (let i = 0; i < value.length; i += 1) {
      if (typeof value[i] !== 'string') {
        return Array.from(iterateStringEntries(value));
      }
    }
    return value;
  };
  const normalizeCodeDictLanguages = (value) => {
    if (!value) return [];
    return normalizeStringArray(value);
  };
  const serializeCodeDictWordsByLanguage = (value) => {
    if (!value) return null;
    const entries = value instanceof Map
      ? value.entries()
      : Object.entries(value);
    const out = {};
    for (const [lang, words] of entries) {
      if (typeof lang !== 'string' || !lang) continue;
      const list = normalizeStringArray(words);
      if (list.length) out[lang] = list;
    }
    return Object.keys(out).length ? out : null;
  };
  if (!poolConfig || poolConfig.enabled === false) return null;
  let Piscina;
  try {
    Piscina = (await import('piscina')).default;
  } catch (err) {
    log(`Worker pool unavailable (piscina missing): ${err?.message || err}`);
    return null;
  }
  const maxRestartAttempts = 3;
  const restartBaseDelayMs = 5000;
  const restartMaxDelayMs = 10000;
  try {
    const configuredMaxWorkers = Number.isFinite(poolConfig?.maxWorkers)
      ? Math.max(1, Math.floor(poolConfig.maxWorkers))
      : 1;
    const autoDownscaleOnPressure = poolConfig?.autoDownscaleOnPressure !== false;
    const downscaleMinWorkers = Number.isFinite(poolConfig?.downscaleMinWorkers)
      ? Math.max(1, Math.min(configuredMaxWorkers, Math.floor(poolConfig.downscaleMinWorkers)))
      : Math.max(1, Math.floor(configuredMaxWorkers * 0.5));
    const downscaleRssThreshold = Number.isFinite(poolConfig?.downscaleRssThreshold)
      ? Math.max(0.5, Math.min(0.99, Number(poolConfig.downscaleRssThreshold)))
      : 0.9;
    const downscaleGcThreshold = Number.isFinite(poolConfig?.downscaleGcThreshold)
      ? Math.max(0.5, Math.min(0.99, Number(poolConfig.downscaleGcThreshold)))
      : 0.85;
    const downscaleCooldownMs = Number.isFinite(poolConfig?.downscaleCooldownMs)
      ? Math.max(1000, Math.floor(Number(poolConfig.downscaleCooldownMs)))
      : 15000;
    const upscaleCooldownMs = Number.isFinite(poolConfig?.upscaleCooldownMs)
      ? Math.max(1000, Math.floor(Number(poolConfig.upscaleCooldownMs)))
      : Math.max(1000, downscaleCooldownMs);
    const upscaleRssThreshold = Number.isFinite(poolConfig?.upscaleRssThreshold)
      ? Math.max(0.4, Math.min(downscaleRssThreshold, Number(poolConfig.upscaleRssThreshold)))
      : Math.max(0.4, downscaleRssThreshold - 0.1);
    const upscaleGcThreshold = Number.isFinite(poolConfig?.upscaleGcThreshold)
      ? Math.max(0.4, Math.min(downscaleGcThreshold, Number(poolConfig.upscaleGcThreshold)))
      : Math.max(0.4, downscaleGcThreshold - 0.1);
    let pool = null;
    let disabled = false;
    let permanentlyDisabled = false;
    let restartAttempts = 0;
    let restartAtMs = 0;
    let restarting = null;
    let activeTasks = 0;
    let shutdownWhenIdle = false;
    let pendingRestart = false;
    let quantizeTypedTempBuffers = 0;
    let effectiveMaxWorkers = configuredMaxWorkers;
    let numaPinningPlan = resolveNumaPinningPlan({
      config: poolConfig,
      maxWorkers: effectiveMaxWorkers
    });
    const workerNumaNodeByThreadId = new Map();
    let workerCreateOrdinal = 0;
    let pressureDownscaleEvents = 0;
    let pressureUpscaleEvents = 0;
    let lastPressureDownscaleAtMs = 0;
    let lastPressureUpscaleAtMs = 0;
    const workerExecArgv = buildWorkerExecArgv();
    const heapPolicy = resolveWorkerHeapBudgetPolicy({
      targetPerWorkerMb: poolConfig.heapTargetMb,
      minPerWorkerMb: poolConfig.heapMinMb,
      maxPerWorkerMb: poolConfig.heapMaxMb
    });
    const resolveResourceLimitsForWorkers = (maxWorkers) => resolveWorkerResourceLimits(maxWorkers, {
      targetPerWorkerMb: heapPolicy.targetPerWorkerMb,
      minPerWorkerMb: heapPolicy.minPerWorkerMb,
      maxPerWorkerMb: heapPolicy.maxPerWorkerMb
    });
    let currentResourceLimits = resolveResourceLimitsForWorkers(effectiveMaxWorkers);
    const serializedDictWords = dictSharedForPool?.bytes && dictSharedForPool?.offsets
      ? null
      : normalizeStringArray(dictWordsForPool);
    const serializedCodeDictWords = normalizeStringArray(codeDictWordsForPool);
    const serializedCodeDictByLanguage = serializeCodeDictWordsByLanguage(codeDictWordsByLanguageForPool);
    const serializedCodeDictLanguages = normalizeCodeDictLanguages(codeDictLanguagesForPool);
    const hasCodeDictLangs = codeDictLanguagesForPool != null;
    const serializedTreeSitterPayload = sanitizeTreeSitterConfig(treeSitterConfig);
    const workerTaskMetricPool = createBoundedObjectPool({
      maxSize: 1024,
      create: () => ({
        pool: 'unknown',
        task: 'unknown',
        worker: 'unknown',
        status: 'unknown',
        seconds: 0
      }),
      reset: (entry) => {
        entry.pool = 'unknown';
        entry.task = 'unknown';
        entry.worker = 'unknown';
        entry.status = 'unknown';
        entry.seconds = 0;
        return entry;
      }
    });
    const tokenizePayloadMetaPool = createBoundedObjectPool({
      maxSize: 512,
      create: () => ({ file: null, size: null, textLength: null, mode: null, ext: null }),
      reset: (entry) => {
        entry.file = null;
        entry.size = null;
        entry.textLength = null;
        entry.mode = null;
        entry.ext = null;
        return entry;
      }
    });
    const quantizePayloadMetaPool = createBoundedObjectPool({
      maxSize: 512,
      create: () => ({ vectorCount: null, levels: null }),
      reset: (entry) => {
        entry.vectorCount = null;
        entry.levels = null;
        return entry;
      }
    });
    const crashPayloadMetaPool = createBoundedObjectPool({
      maxSize: 64,
      create: () => ({ threadId: null }),
      reset: (entry) => {
        entry.threadId = null;
        return entry;
      }
    });
    const withPooledPayloadMeta = (poolForMeta, assign, fn) => {
      const meta = poolForMeta.acquire();
      assign(meta);
      try {
        return fn(meta);
      } finally {
        poolForMeta.release(meta);
      }
    };
    const assignTokenizePayloadMeta = (target, payload) => {
      target.file = payload && typeof payload.file === 'string' ? payload.file : null;
      target.size = payload && Number.isFinite(payload.size) ? payload.size : null;
      target.textLength = payload && typeof payload.text === 'string' ? payload.text.length : null;
      target.mode = payload?.mode || null;
      target.ext = payload?.ext || null;
    };
    const assignQuantizePayloadMeta = (target, payload) => {
      target.vectorCount = payload && Array.isArray(payload.vectors)
        ? payload.vectors.length
        : null;
      target.levels = payload?.levels ?? null;
    };
    const normalizeQuantizeVectors = (vectors) => {
      if (!Array.isArray(vectors) || vectors.length === 0) {
        return { vectors: [], transferList: [], typedTempCount: 0 };
      }
      const normalizedVectors = new Array(vectors.length);
      const transferList = [];
      let typedTempCount = 0;
      for (let i = 0; i < vectors.length; i += 1) {
        const vec = vectors[i];
        if (ArrayBuffer.isView(vec) && !(vec instanceof DataView)) {
          normalizedVectors[i] = vec;
          if (vec.byteOffset === 0 && vec.byteLength === vec.buffer.byteLength) {
            transferList.push(vec.buffer);
          }
          continue;
        }
        if (Array.isArray(vec)) {
          const typed = new Float32Array(vec.length);
          for (let j = 0; j < vec.length; j += 1) {
            const numeric = Number(vec[j]);
            typed[j] = Number.isFinite(numeric) ? numeric : 0;
          }
          normalizedVectors[i] = typed;
          transferList.push(typed.buffer);
          typedTempCount += 1;
          continue;
        }
        normalizedVectors[i] = vec;
      }
      return { vectors: normalizedVectors, transferList, typedTempCount };
    };
    const buildQuantizeRunPayload = (payload) => {
      const basePayload = payload && typeof payload === 'object' ? payload : {};
      const vectors = Array.isArray(basePayload.vectors) ? basePayload.vectors : null;
      if (!vectors) {
        return { payload: basePayload, transferList: [], typedTempCount: 0 };
      }
      const normalized = normalizeQuantizeVectors(vectors);
      const runPayload = normalized.typedTempCount > 0
        ? { ...basePayload, vectors: normalized.vectors }
        : basePayload;
      return {
        payload: runPayload,
        transferList: normalized.transferList,
        typedTempCount: normalized.typedTempCount
      };
    };
    const normalizedStage = typeof stage === 'string' && stage.trim()
      ? stage.trim().toLowerCase()
      : 'unknown';
    const maxGlobalRssBytes = Number.isFinite(Number(memoryPolicy?.maxGlobalRssMb))
      ? Math.max(1, Math.floor(Number(memoryPolicy.maxGlobalRssMb) * 1024 * 1024))
      : Math.max(1, Math.floor(Number(os.totalmem() || 0) * 0.9));
    const gcSampleIntervalMs = 25;
    const gcByWorker = new Map();
    let lastGcSampleAt = 0;
    let gcSampleCount = 0;
    let gcGlobalPressure = 0;
    let gcGlobalHeapUtilization = 0;
    let gcGlobalRssPressure = 0;
    const clampRatio = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return 0;
      return Math.max(0, Math.min(1, parsed));
    };
    const updateGcTelemetry = (workerId, durationMs = null) => {
      const now = Date.now();
      if ((now - lastGcSampleAt) < gcSampleIntervalMs) return null;
      lastGcSampleAt = now;
      const usage = process.memoryUsage();
      const heapUsed = Number(usage?.heapUsed) || 0;
      const heapTotal = Number(usage?.heapTotal) || 0;
      const rss = Number(usage?.rss) || 0;
      const heapUtilization = heapTotal > 0
        ? clampRatio(heapUsed / heapTotal)
        : 0;
      const rssPressure = maxGlobalRssBytes
        ? clampRatio(rss / maxGlobalRssBytes)
        : 0;
      const pressureRatio = clampRatio(Math.max(heapUtilization, rssPressure));
      gcSampleCount += 1;
      gcGlobalPressure = pressureRatio;
      gcGlobalHeapUtilization = heapUtilization;
      gcGlobalRssPressure = rssPressure;
      setStageGcPressure({ stage: normalizedStage, value: pressureRatio });
      if (workerId == null) return;
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
    const createPool = () => {
      currentResourceLimits = resolveResourceLimitsForWorkers(effectiveMaxWorkers);
      numaPinningPlan = resolveNumaPinningPlan({
        config: poolConfig,
        maxWorkers: effectiveMaxWorkers
      });
      workerNumaNodeByThreadId.clear();
      workerCreateOrdinal = 0;
      const workerData = {
        dictConfig: sanitizeDictConfig(dictConfig),
        postingsConfig: postingsConfig || {},
        numaPinning: numaPinningPlan.active
          ? {
            active: true,
            strategy: numaPinningPlan.strategy,
            nodeCount: numaPinningPlan.nodeCount,
            assignments: Array.isArray(numaPinningPlan.assignments)
              ? Array.from(numaPinningPlan.assignments)
              : []
          }
          : {
            active: false,
            reason: numaPinningPlan.reason || 'disabled'
          }
      };
      if (dictSharedForPool?.bytes && dictSharedForPool?.offsets) {
        workerData.dictShared = dictSharedForPool;
      } else if (serializedDictWords.length) {
        workerData.dictWords = serializedDictWords;
      }
      if (serializedCodeDictWords.length) {
        workerData.codeDictWords = serializedCodeDictWords;
      }
      if (serializedCodeDictByLanguage) {
        workerData.codeDictWordsByLanguage = serializedCodeDictByLanguage;
      }
      if (hasCodeDictLangs || serializedCodeDictLanguages.length) {
        workerData.codeDictLanguages = serializedCodeDictLanguages;
      }
      if (serializedTreeSitterPayload) {
        workerData.treeSitter = serializedTreeSitterPayload;
      }
      return new Piscina({
        filename: fileURLToPath(new URL('./indexer-worker.js', import.meta.url)),
        maxThreads: effectiveMaxWorkers,
        idleTimeout: poolConfig.idleTimeoutMs,
        taskTimeout: poolConfig.taskTimeoutMs,
        recordTiming: true,
        execArgv: workerExecArgv,
        ...(currentResourceLimits ? { resourceLimits: currentResourceLimits } : {}),
        workerData
      });
    };
    const updatePoolMetrics = () => {
      if (!pool) return;
      setWorkerQueueDepth({ pool: poolLabel, value: pool.queueSize });
      setWorkerActiveTasks({ pool: poolLabel, value: activeTasks });
    };
    const shutdownPool = async () => {
      if (!pool) return;
      try {
        await pool.destroy();
      } catch (err) {
        const detail = summarizeError(err);
        log(`Worker pool shutdown failed: ${detail || 'unknown error'}`);
      }
      pool = null;
    };
    const disablePermanently = async (reason) => {
      if (permanentlyDisabled) return;
      permanentlyDisabled = true;
      disabled = true;
      pendingRestart = false;
      restartAttempts = maxRestartAttempts + 1;
      if (reason) log(`Worker pool disabled permanently: ${reason}`);
      if (activeTasks === 0) {
        await shutdownPool();
      } else {
        shutdownWhenIdle = true;
      }
    };
    const scheduleRestart = async (reason) => {
      if (permanentlyDisabled) return;
      if (!pool && disabled && restartAttempts > maxRestartAttempts) return;
      disabled = true;
      restartAttempts += 1;
      incWorkerRetries({ pool: poolLabel });
      if (restartAttempts > maxRestartAttempts) {
        pendingRestart = false;
        permanentlyDisabled = true;
        disabled = true;
        if (reason) log(`Worker pool disabled: ${reason}`);
        if (activeTasks === 0) {
          await shutdownPool();
        } else {
          shutdownWhenIdle = true;
        }
        return;
      }
      const delayMs = Math.min(
        restartMaxDelayMs,
        restartBaseDelayMs * (2 ** Math.max(0, restartAttempts - 1))
      );
      restartAtMs = Date.now() + delayMs;
      pendingRestart = true;
      if (activeTasks === 0) {
        await shutdownPool();
      } else {
        shutdownWhenIdle = true;
      }
      if (reason) log(`Worker pool disabled: ${reason} (retry in ${delayMs}ms).`);
    };
    const scheduleReconfigureRestart = async (reason) => {
      if (permanentlyDisabled) return;
      disabled = true;
      pendingRestart = true;
      restartAtMs = Date.now() + 50;
      if (activeTasks === 0) {
        await shutdownPool();
      } else {
        shutdownWhenIdle = true;
      }
      if (reason) log(`Worker pool reconfigure: ${reason}`);
    };
    /**
     * Adapt pool size in response to pressure samples with hysteresis:
     * - downscale quickly when pressure breaches thresholds
     * - upscale gradually only after sustained recovery
     */
    const maybeReduceWorkersOnPressure = async ({ rssPressure, gcPressure }) => {
      if (!autoDownscaleOnPressure || permanentlyDisabled) return;
      if (disabled || pendingRestart || restarting) return;
      const pressureHigh = shouldDownscaleWorkersForPressure({
        rssPressure,
        gcPressure,
        rssThreshold: downscaleRssThreshold,
        gcThreshold: downscaleGcThreshold
      });
      if (!pressureHigh) {
        const pressureRecovered = rssPressure <= upscaleRssThreshold && gcPressure <= upscaleGcThreshold;
        if (!pressureRecovered) return;
        if (effectiveMaxWorkers >= configuredMaxWorkers) return;
        const now = Date.now();
        if ((now - lastPressureDownscaleAtMs) < upscaleCooldownMs) return;
        if ((now - lastPressureUpscaleAtMs) < upscaleCooldownMs) return;
        const nextWorkers = Math.min(configuredMaxWorkers, effectiveMaxWorkers + 1);
        if (nextWorkers <= effectiveMaxWorkers) return;
        const previousWorkers = effectiveMaxWorkers;
        effectiveMaxWorkers = nextWorkers;
        pressureUpscaleEvents += 1;
        lastPressureUpscaleAtMs = now;
        await scheduleReconfigureRestart(
          `rssPressure=${rssPressure.toFixed(3)} gcPressure=${gcPressure.toFixed(3)} ` +
          `recovery(rss<=${upscaleRssThreshold.toFixed(2)},gc<=${upscaleGcThreshold.toFixed(2)}) ` +
          `workers ${previousWorkers}->${nextWorkers}.`
        );
        return;
      }
      if (effectiveMaxWorkers <= downscaleMinWorkers) return;
      const now = Date.now();
      if ((now - lastPressureDownscaleAtMs) < downscaleCooldownMs) return;
      const nextWorkers = Math.max(downscaleMinWorkers, effectiveMaxWorkers - 1);
      if (nextWorkers >= effectiveMaxWorkers) return;
      const previousWorkers = effectiveMaxWorkers;
      effectiveMaxWorkers = nextWorkers;
      pressureDownscaleEvents += 1;
      lastPressureDownscaleAtMs = now;
      await scheduleReconfigureRestart(
        `rssPressure=${rssPressure.toFixed(3)} gcPressure=${gcPressure.toFixed(3)} ` +
        `thresholds(rss=${downscaleRssThreshold.toFixed(2)},gc=${downscaleGcThreshold.toFixed(2)}) ` +
        `workers ${previousWorkers}->${nextWorkers}.`
      );
    };
    const maybeRestart = async () => {
      if (permanentlyDisabled) {
        pendingRestart = false;
        return false;
      }
      if (!pendingRestart) return false;
      if (!disabled) {
        pendingRestart = false;
        return false;
      }
      if (activeTasks > 0) return false;
      if (Date.now() < restartAtMs) return false;
      return ensurePool();
    };
    const ensurePool = async () => {
      if (permanentlyDisabled) {
        pendingRestart = false;
        return false;
      }
      if (pool && !disabled) {
        pendingRestart = false;
        return true;
      }
      if (restartAttempts > maxRestartAttempts) {
        pendingRestart = false;
        return false;
      }
      if (!pendingRestart) return false;
      if (activeTasks > 0) return false;
      if (Date.now() < restartAtMs) return false;
      if (!restarting) {
        restarting = (async () => {
          try {
            await shutdownPool();
            pool = createPool();
            attachPoolListeners(pool);
            disabled = false;
            restartAttempts = 0;
            restartAtMs = 0;
            pendingRestart = false;
            log('Worker pool restarted.');
          } catch (err) {
            const detail = summarizeError(err);
            await scheduleRestart(`restart failed: ${detail || 'unknown error'}`);
          } finally {
            restarting = null;
          }
        })();
      }
      await restarting;
      return !!pool && !disabled;
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
    pool = createPool();
    if (poolConfig?.numaPinning?.enabled === true) {
      if (numaPinningPlan.active) {
        log(
          `Worker pool NUMA pinning active (${poolLabel}): strategy=${numaPinningPlan.strategy}, ` +
          `nodes=${numaPinningPlan.nodeCount}, workers=${effectiveMaxWorkers}.`
        );
      } else {
        log(
          `Worker pool NUMA pinning not active (${poolLabel}): ${numaPinningPlan.reason || 'disabled'}.`
        );
      }
    }
    attachPoolListeners(pool);
    updatePoolMetrics();
    return {
      config,
      heapPolicy,
      get pool() {
        return pool;
      },
      stats() {
        const queued = Number.isFinite(pool?.queueSize) ? pool.queueSize : 0;
        const queueUtilization = effectiveMaxWorkers > 0
          ? Math.max(0, Math.min(1, (activeTasks + queued) / effectiveMaxWorkers))
          : null;
        return {
          pool: poolLabel,
          activeTasks,
          queuedTasks: queued,
          maxWorkers: effectiveMaxWorkers,
          configuredMaxWorkers,
          utilization: queueUtilization,
          disabled,
          pendingRestart,
          restartAttempts,
          heapPolicy,
          heapLimitMb: Number(currentResourceLimits?.maxOldGenerationSizeMb) || null,
          quantizeTypedTempBuffers,
          pressureDownscale: {
            enabled: autoDownscaleOnPressure,
            rssThreshold: downscaleRssThreshold,
            gcThreshold: downscaleGcThreshold,
            minWorkers: downscaleMinWorkers,
            cooldownMs: downscaleCooldownMs,
            events: pressureDownscaleEvents,
            recoveryEvents: pressureUpscaleEvents,
            upscaleCooldownMs,
            upscaleRssThreshold,
            upscaleGcThreshold,
            lastEventAt: lastPressureDownscaleAtMs
              ? new Date(lastPressureDownscaleAtMs).toISOString()
              : null
          },
          numaPinning: {
            enabled: poolConfig?.numaPinning?.enabled === true,
            active: numaPinningPlan.active === true,
            reason: numaPinningPlan.reason || null,
            strategy: numaPinningPlan.strategy || null,
            nodeCount: Number(numaPinningPlan.nodeCount) || 1,
            workersAssigned: workerNumaNodeByThreadId.size,
            assignments: Object.fromEntries(workerNumaNodeByThreadId.entries())
          },
          gcPressure: {
            stage: normalizedStage,
            samples: gcSampleCount,
            global: {
              pressureRatio: gcGlobalPressure,
              heapUtilization: gcGlobalHeapUtilization,
              rssPressure: gcGlobalRssPressure
            },
            workers: Array.from(gcByWorker.values())
          },
          objectPools: {
            workerTaskMetrics: workerTaskMetricPool.stats(),
            tokenizePayloadMeta: tokenizePayloadMetaPool.stats(),
            quantizePayloadMeta: quantizePayloadMetaPool.stats(),
            crashPayloadMeta: crashPayloadMetaPool.stats()
          }
        };
      },
      dictConfig: sanitizeDictConfig(dictConfig),
      shouldUseForFile(sizeBytes) {
        if (disabled || permanentlyDisabled) return false;
        if (config.enabled === true) return true;
        if (config.enabled === 'auto') {
          const normalizedSizeBytes = Number.isFinite(sizeBytes) ? sizeBytes : 0;
          const minFileBytes = Number.isFinite(config.minFileBytes) && config.minFileBytes > 0
            ? Math.floor(config.minFileBytes)
            : null;
          if (minFileBytes != null && normalizedSizeBytes < minFileBytes) {
            return false;
          }
          if (config.maxFileBytes == null) return true;
          return normalizedSizeBytes <= config.maxFileBytes;
        }
        return false;
      },
      async tokenizeChunk(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (disabled && !(await ensurePool())) {
            if (crashLogger?.enabled) {
              withPooledPayloadMeta(tokenizePayloadMetaPool, (meta) => {
                assignTokenizePayloadMeta(meta, payload);
              }, (payloadMeta) => {
                crashLogger.logError({
                  phase: 'worker-tokenize',
                  message: 'worker pool unavailable',
                  stack: null,
                  name: 'Error',
                  code: null,
                  task: 'tokenizeChunk',
                  payloadMeta: payload ? payloadMeta : null
                });
              });
            }
            return null;
          }
          const result = await pool.run(
            sanitizePoolPayload(payload, sanitizeDictConfig(payload?.dictConfig)),
            { name: 'tokenizeChunk' }
          );
          updatePoolMetrics();
          return result;
        } catch (err) {
          const detail = summarizeError(err);
          const opaqueFailure = !detail || detail === 'Error';
          const errorName = err?.name || '';
          const isCloneError = errorName.toLowerCase().includes('dataclone')
            || errorName.toLowerCase().includes('datacloneerror')
            || errorName.toLowerCase().includes('dataclone');
          const reason = detail || err?.message || String(err);
          if (isCloneError) {
            await disablePermanently(reason || 'data-clone error');
          } else if (opaqueFailure) {
            await disablePermanently(reason || 'worker failure');
          } else {
            await scheduleRestart(reason);
          }
          if (crashLogger?.enabled) {
            withPooledPayloadMeta(tokenizePayloadMetaPool, (meta) => {
              assignTokenizePayloadMeta(meta, payload);
            }, (payloadMeta) => {
              crashLogger.logError({
                phase: 'worker-tokenize',
                message: detail || err?.message || String(err),
                stack: err?.stack || null,
                name: err?.name || null,
                code: err?.code || null,
                task: 'tokenizeChunk',
                payloadMeta: payload ? payloadMeta : null,
                raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true }),
                errors: Array.isArray(err?.errors)
                  ? err.errors.map((inner) => ({
                    message: inner?.message || String(inner),
                    stack: inner?.stack || null,
                    name: inner?.name || null,
                    code: inner?.code || null,
                    raw: util.inspect(inner, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }))
                  : null,
                cause: err?.cause
                  ? {
                    message: err.cause?.message || String(err.cause),
                    stack: err.cause?.stack || null,
                    name: err.cause?.name || null,
                    code: err.cause?.code || null,
                    raw: util.inspect(err.cause, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }
                  : null
              });
            });
          }
          return null;
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          if (activeTasks === 0) {
            if (shutdownWhenIdle) {
              shutdownWhenIdle = false;
              await shutdownPool();
            }
            await maybeRestart();
          }
        }
      },
      async runTokenize(payload) {
        // Backward-compat alias for tests and callers that still use runTokenize.
        return this.tokenizeChunk(payload);
      },
      async runQuantize(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (disabled && !(await ensurePool())) {
            if (crashLogger?.enabled) {
              withPooledPayloadMeta(quantizePayloadMetaPool, (meta) => {
                assignQuantizePayloadMeta(meta, payload);
              }, (payloadMeta) => {
                crashLogger.logError({
                  phase: 'worker-quantize',
                  message: 'worker pool unavailable',
                  stack: null,
                  name: 'Error',
                  code: null,
                  task: 'quantizeVectors',
                  payloadMeta: payload ? payloadMeta : null
                });
              });
            }
            return null;
          }
          const sanitizedPayload = sanitizeQuantizePayload(payload);
          const {
            payload: runPayload,
            transferList,
            typedTempCount
          } = buildQuantizeRunPayload(sanitizedPayload);
          quantizeTypedTempBuffers += typedTempCount;
          const runOptions = transferList.length
            ? { name: 'quantizeVectors', transferList }
            : { name: 'quantizeVectors' };
          const result = await pool.run(runPayload, runOptions);
          updatePoolMetrics();
          return result;
        } catch (err) {
          const detail = summarizeError(err);
          const opaqueFailure = !detail || detail === 'Error';
          const errorName = err?.name || '';
          const isCloneError = errorName.toLowerCase().includes('dataclone')
            || errorName.toLowerCase().includes('datacloneerror')
            || errorName.toLowerCase().includes('dataclone');
          const reason = detail || err?.message || String(err);
          if (isCloneError) {
            await disablePermanently(reason || 'data-clone error');
          } else if (opaqueFailure) {
            await disablePermanently(reason || 'worker failure');
          } else {
            await scheduleRestart(reason);
          }
          if (crashLogger?.enabled) {
            withPooledPayloadMeta(quantizePayloadMetaPool, (meta) => {
              assignQuantizePayloadMeta(meta, payload);
            }, (payloadMeta) => {
              crashLogger.logError({
                phase: 'worker-quantize',
                message: err?.message || String(err),
                stack: err?.stack || null,
                name: err?.name || null,
                code: err?.code || null,
                task: 'quantizeVectors',
                payloadMeta: payload ? payloadMeta : null,
                raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true }),
                errors: Array.isArray(err?.errors)
                  ? err.errors.map((inner) => ({
                    message: inner?.message || String(inner),
                    stack: inner?.stack || null,
                    name: inner?.name || null,
                    code: inner?.code || null,
                    raw: util.inspect(inner, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }))
                  : null,
                cause: err?.cause
                  ? {
                    message: err.cause?.message || String(err.cause),
                    stack: err.cause?.stack || null,
                    name: err.cause?.name || null,
                    code: err.cause?.code || null,
                    raw: util.inspect(err.cause, { depth: 3, breakLength: 120, showHidden: true, getters: true })
                  }
                  : null
              });
            });
          }
          return null;
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          if (activeTasks === 0) {
            if (shutdownWhenIdle) {
              shutdownWhenIdle = false;
              await shutdownPool();
            }
            await maybeRestart();
          }
        }
      },
      async destroy() {
        disabled = true;
        restartAttempts = maxRestartAttempts + 1;
        await shutdownPool();
      }
    };
  } catch (err) {
    log(`Worker pool unavailable: ${err?.message || err}`);
    return null;
  }
}

/**
 * Create tokenize/quantize worker pools from a shared pool budget. When pool
 * splitting is disabled, both roles point to the same pool.
 *
 * @param {object} [input]
 * @returns {Promise<{tokenizePool:object|null,quantizePool:object|null,destroy:()=>Promise<void>}>}
 */
export async function createIndexerWorkerPools(input = {}) {
  const baseConfig = input.config;
  if (!baseConfig || baseConfig.enabled === false) {
    return { tokenizePool: null, quantizePool: null, destroy: async () => {} };
  }
  if (!baseConfig.splitByTask) {
    const pool = await createIndexerWorkerPool({ ...input, poolName: 'tokenize' });
    const destroy = async () => {
      if (pool?.destroy) await pool.destroy();
    };
    return { tokenizePool: pool, quantizePool: pool, destroy };
  }

  // When splitting work across pools, treat maxWorkers as a TOTAL thread budget.
  // The previous behavior created multiple pools each with maxWorkers threads,
  // which could exceed the intended cap and exhaust memory on some platforms.
  const totalBudget = Number.isFinite(baseConfig.maxWorkers)
    ? Math.max(1, Math.floor(baseConfig.maxWorkers))
    : 1;

  // If there is no room to split, fall back to a single pool.
  if (totalBudget <= 1) {
    const pool = await createIndexerWorkerPool({ ...input, poolName: 'tokenize' });
    const destroy = async () => {
      if (pool?.destroy) await pool.destroy();
    };
    return { tokenizePool: pool, quantizePool: pool, destroy };
  }

  const requestedQuantize = Number.isFinite(baseConfig.quantizeMaxWorkers)
    ? Math.max(1, Math.floor(baseConfig.quantizeMaxWorkers))
    : Math.max(1, Math.floor(totalBudget / 2));
  const quantizeBudget = Math.min(Math.max(1, requestedQuantize), totalBudget - 1);
  const tokenizeBudget = Math.max(1, totalBudget - quantizeBudget);

  const tokenizePool = await createIndexerWorkerPool({
    ...input,
    config: { ...baseConfig, maxWorkers: tokenizeBudget },
    poolName: 'tokenize'
  });
  const quantizePool = await createIndexerWorkerPool({
    ...input,
    config: { ...baseConfig, maxWorkers: quantizeBudget },
    poolName: 'quantize'
  });

  const finalTokenizePool = tokenizePool || quantizePool;
  const finalQuantizePool = quantizePool || tokenizePool;
  const destroy = async () => {
    if (finalTokenizePool?.destroy) await finalTokenizePool.destroy();
    if (finalQuantizePool?.destroy && finalQuantizePool !== finalTokenizePool) {
      await finalQuantizePool.destroy();
    }
  };
  return {
    tokenizePool: finalTokenizePool,
    quantizePool: finalQuantizePool,
    destroy
  };
}
