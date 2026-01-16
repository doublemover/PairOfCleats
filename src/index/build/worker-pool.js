import os from 'node:os';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { log as defaultLog } from '../../shared/progress.js';
import {
  incWorkerRetries,
  observeWorkerTaskDuration,
  setWorkerActiveTasks,
  setWorkerQueueDepth
} from '../../shared/metrics.js';

const summarizeError = (err, options = {}) => {
  const {
    maxLen = 240,
    fullDepth = false
  } = options;
  if (!err) return '';
  const asString = (value) => (typeof value === 'string' ? value.trim() : '');
  let detail = asString(err?.message)
    || asString(err?.code)
    || asString(err?.name)
    || asString(typeof err === 'string' ? err : '');
  if (!detail || detail === '[object Object]' || detail === '{}') {
    detail = util.inspect(err, {
      depth: fullDepth ? null : 2,
      breakLength: 120,
      maxArrayLength: fullDepth ? null : 6,
      maxStringLength: fullDepth ? null : 200,
      showHidden: true,
      getters: true
    });
    if (detail === '{}' || detail === '[object Object]') {
      try {
        detail = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
      } catch (jsonErr) {
        detail = detail || `unserializable error: ${asString(jsonErr?.message)}`;
      }
    }
  }
  detail = detail.replace(/\s+/g, ' ').trim();
  if (maxLen > 3 && detail.length > maxLen) {
    detail = `${detail.slice(0, maxLen - 3)}...`;
  }
  return detail;
};

const normalizeEnabled = (raw) => {
  if (raw === true || raw === false) return raw;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'auto') return 'auto';
  return 'auto';
};

const buildWorkerExecArgv = () => process.execArgv.filter((arg) => {
  if (!arg) return false;
  return !arg.startsWith('--max-old-space-size')
    && !arg.startsWith('--max-semi-space-size');
});

const resolveMemoryWorkerCap = (requested) => {
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  if (!Number.isFinite(requested) || requested <= 0) return null;
  if (!Number.isFinite(totalMemMb) || totalMemMb <= 0) return null;
  const cap = Math.max(1, Math.floor(totalMemMb / 4096));
  return Math.min(requested, cap);
};

const parseMaxOldSpaceMb = () => {
  const args = process.execArgv || [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--max-old-space-size=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    if (arg === '--max-old-space-size') {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
  }
  return null;
};

const resolveWorkerResourceLimits = (maxWorkers) => {
  const maxOldSpaceMb = parseMaxOldSpaceMb();
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  if (!Number.isFinite(maxWorkers) || maxWorkers <= 0) return null;

  // Keep worker heaps conservative: the main process may run with a very large
  // --max-old-space-size, but spawning many isolates with large old-gen limits
  // can quickly exhaust address space (especially on Windows).
  let basisMb = totalMemMb;
  if (Number.isFinite(maxOldSpaceMb) && maxOldSpaceMb > 0) {
    basisMb = Number.isFinite(basisMb) && basisMb > 0
      ? Math.min(basisMb, maxOldSpaceMb)
      : maxOldSpaceMb;
  }
  if (!Number.isFinite(basisMb) || basisMb <= 0) return null;

  // Hard cap the sizing basis to avoid inflating per-worker limits on high-RAM
  // machines. This is a safety valve; workloads that need larger heaps can
  // still run in-process without the pool.
  const basisCapMb = 8192;
  basisMb = Math.min(basisMb, basisCapMb);

  const perWorker = Math.max(256, Math.floor(basisMb / Math.max(1, maxWorkers * 2)));
  const platformCap = process.platform === 'win32' ? 1024 : 2048;
  const capped = Math.min(platformCap, perWorker);
  return { maxOldGenerationSizeMb: capped };
};

/**
 * Normalize worker pool configuration.
 * @param {object} raw
 * @param {{cpuLimit?:number}} options
 * @returns {object}
 */
export function normalizeWorkerPoolConfig(raw = {}, options = {}) {
  const enabled = normalizeEnabled(raw.enabled);
  const cpuLimit = Number.isFinite(options.cpuLimit)
    ? Math.max(1, Math.floor(options.cpuLimit))
    : Math.max(1, os.cpus().length * 4);
  const defaultMaxWorkers = Number.isFinite(options.defaultMaxWorkers)
    ? Math.max(1, Math.floor(options.defaultMaxWorkers))
    : Math.max(1, cpuLimit);
  const hardMaxWorkers = Number.isFinite(options.hardMaxWorkers)
    ? Math.max(1, Math.floor(options.hardMaxWorkers))
    : null;
  const maxWorkersRaw = Number(raw.maxWorkers);
  const allowOverCap = raw.allowOverCap === true || options.allowOverCap === true;
  const requestedMax = Number.isFinite(maxWorkersRaw) && maxWorkersRaw > 0
    ? Math.max(1, Math.floor(maxWorkersRaw))
    : defaultMaxWorkers;
  const cappedMax = (!allowOverCap && Number.isFinite(hardMaxWorkers))
    ? Math.min(requestedMax, hardMaxWorkers)
    : requestedMax;
  const maxWorkers = Math.max(1, cappedMax);
  const maxFileBytesRaw = raw.maxFileBytes;
  let maxFileBytes = 512 * 1024;
  if (maxFileBytesRaw === false || maxFileBytesRaw === 0) {
    maxFileBytes = null;
  } else {
    const maxFileBytesParsed = Number(maxFileBytesRaw);
    if (Number.isFinite(maxFileBytesParsed) && maxFileBytesParsed > 0) {
      maxFileBytes = Math.floor(maxFileBytesParsed);
    }
  }
  const idleTimeoutMsRaw = Number(raw.idleTimeoutMs);
  const idleTimeoutMs = Number.isFinite(idleTimeoutMsRaw) && idleTimeoutMsRaw > 0
    ? Math.floor(idleTimeoutMsRaw)
    : 30000;
  const taskTimeoutMsRaw = Number(raw.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw) && taskTimeoutMsRaw > 0
    ? Math.floor(taskTimeoutMsRaw)
    : 60000;
  const quantizeBatchRaw = Number(raw.quantizeBatchSize);
  const quantizeBatchSize = Number.isFinite(quantizeBatchRaw) && quantizeBatchRaw > 0
    ? Math.floor(quantizeBatchRaw)
    : 128;
  const splitByTask = raw.splitByTask === true || raw.splitTasks === true;
  const quantizeMaxWorkersRaw = Number(raw.quantizeMaxWorkers);
  const quantizeMaxWorkers = Number.isFinite(quantizeMaxWorkersRaw) && quantizeMaxWorkersRaw > 0
    ? Math.max(1, Math.floor(quantizeMaxWorkersRaw))
    : null;
  return {
    enabled,
    maxWorkers,
    maxFileBytes,
    idleTimeoutMs,
    taskTimeoutMs,
    quantizeBatchSize,
    splitByTask,
    quantizeMaxWorkers
  };
}

/**
 * Resolve worker pool configuration with environment overrides.
 * @param {object} raw
 * @param {{workerPool?:string}|null} envConfig
 * @param {{cpuLimit?:number}} [options]
 * @returns {object}
 */
export function resolveWorkerPoolConfig(raw = {}, envConfig = null, options = {}) {
  const config = normalizeWorkerPoolConfig(raw, options);
  const override = typeof envConfig?.workerPool === 'string'
    ? envConfig.workerPool.trim().toLowerCase()
    : '';
  if (override) {
    if (['0', 'false', 'off', 'disable', 'disabled'].includes(override)) {
      config.enabled = false;
    } else if (['1', 'true', 'on', 'enable', 'enabled'].includes(override)) {
      config.enabled = true;
    } else if (override === 'auto') {
      config.enabled = 'auto';
    }
  }
  return config;
}

/**
 * Create a worker pool for CPU-bound tokenization/quantization work.
 * @param {object} input
 * @returns {object|null}
 */
export async function createIndexerWorkerPool(input = {}) {
  const {
    config,
    dictWords,
    dictSharedPayload,
    dictConfig,
    postingsConfig,
    crashLogger = null,
    log = defaultLog,
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
  const sanitizeDictConfig = (raw) => {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    return {
      segmentation: typeof cfg.segmentation === 'string' ? cfg.segmentation : 'auto',
      dpMaxTokenLength: Number.isFinite(Number(cfg.dpMaxTokenLength))
        ? Number(cfg.dpMaxTokenLength)
        : 32
    };
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
    let pool = null;
    let disabled = false;
    let permanentlyDisabled = false;
    let restartAttempts = 0;
    let restartAtMs = 0;
    let restarting = null;
    let activeTasks = 0;
    let pendingRestart = false;
    const workerExecArgv = buildWorkerExecArgv();
    const resourceLimits = resolveWorkerResourceLimits(poolConfig.maxWorkers);
    const createPool = () => {
      const workerData = {
        dictConfig: sanitizeDictConfig(dictConfig),
        postingsConfig: postingsConfig || {}
      };
      if (dictSharedForPool?.bytes && dictSharedForPool?.offsets) {
        workerData.dictShared = dictSharedForPool;
      } else {
        workerData.dictWords = Array.isArray(dictWordsForPool)
          ? dictWordsForPool
          : Array.from(dictWordsForPool || []);
      }
      return new Piscina({
        filename: fileURLToPath(new URL('./workers/indexer-worker.js', import.meta.url)),
        maxThreads: poolConfig.maxWorkers,
        idleTimeout: poolConfig.idleTimeoutMs,
        taskTimeout: poolConfig.taskTimeoutMs,
        recordTiming: true,
        execArgv: workerExecArgv,
        ...(resourceLimits ? { resourceLimits } : {}),
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
        if (reason) log(`Worker pool disabled: ${reason}`);
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
      }
      if (reason) log(`Worker pool disabled: ${reason} (retry in ${delayMs}ms).`);
    };
    const maybeRestart = async () => {
      if (permanentlyDisabled) return false;
      if (!pendingRestart || !disabled) return false;
      if (activeTasks > 0) return false;
      if (Date.now() < restartAtMs) return false;
      return ensurePool();
    };
    const ensurePool = async () => {
      if (permanentlyDisabled) return false;
      if (pool && !disabled) return true;
      if (restartAttempts > maxRestartAttempts) return false;
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
    const sanitizePayload = (payload) => {
      if (!payload || typeof payload !== 'object') return payload;
      const safe = {
        text: typeof payload.text === 'string' ? payload.text : '',
        mode: typeof payload.mode === 'string' ? payload.mode : 'code',
        ext: typeof payload.ext === 'string' ? payload.ext : ''
      };
      if (Array.isArray(payload.chargramTokens)) {
        safe.chargramTokens = payload.chargramTokens.filter((token) => typeof token === 'string');
      }
      if (payload.dictConfig && typeof payload.dictConfig === 'object') {
        safe.dictConfig = sanitizeDictConfig(payload.dictConfig);
      }
      return safe;
    };
    const attachPoolListeners = (poolInstance) => {
      if (!poolInstance?.on) return;
      poolInstance.on('message', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'worker-task') {
          observeWorkerTaskDuration({
            pool: poolLabel,
            task: message.task,
            worker: message.threadId,
            status: message.status,
            seconds: Number(message.durationMs) / 1000
          });
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
            crashLogger.logError({
              phase: 'worker-thread',
              message: message.message || 'worker crash',
              stack: message.stack || null,
              name: message.name || null,
              code: null,
              task: message.label || null,
              cloneIssue: message.cloneIssue || null,
              cloneStage: message.stage || null,
              payloadMeta: {
                threadId: message.threadId ?? null
              },
              raw: message.raw || null,
              cause: message.cause || null
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
    attachPoolListeners(pool);
    updatePoolMetrics();
    return {
      config,
      get pool() {
        return pool;
      },
      dictConfig: sanitizeDictConfig(dictConfig),
      shouldUseForFile(sizeBytes) {
        if (disabled || permanentlyDisabled) return false;
        if (config.enabled === true) return true;
        if (config.enabled === 'auto') {
          if (config.maxFileBytes == null) return true;
          return !Number.isFinite(sizeBytes) || sizeBytes <= config.maxFileBytes;
        }
        return false;
      },
      async runTokenize(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (disabled && !(await ensurePool())) return null;
          const result = await pool.run(sanitizePayload(payload), { name: 'tokenizeChunk' });
          updatePoolMetrics();
          return result;
        } catch (err) {
          const isCloneError = err?.name === 'DataCloneError'
            || /could not be cloned|DataCloneError/i.test(err?.message || '');
          const detail = summarizeError(err, { fullDepth: true, maxLen: 0 });
          const opaqueFailure = !detail || detail === '{}' || detail === '[object Object]';
          const reason = isCloneError
            ? (detail ? `data-clone error: ${detail}` : 'data-clone error')
            : (detail ? `worker failure: ${detail}` : 'worker failure');
          if (opaqueFailure) {
            await disablePermanently(reason || 'worker failure');
          } else {
            await scheduleRestart(reason);
          }
          if (crashLogger?.enabled) {
            crashLogger.logError({
              phase: 'worker-tokenize',
              message: detail || err?.message || String(err),
              stack: err?.stack || null,
              name: err?.name || null,
              code: err?.code || null,
              task: 'tokenizeChunk',
              payloadMeta: payload
                ? {
                  file: typeof payload.file === 'string' ? payload.file : null,
                  size: Number.isFinite(payload.size) ? payload.size : null,
                  textLength: typeof payload.text === 'string' ? payload.text.length : null,
                  mode: payload.mode || null,
                  ext: payload.ext || null
                }
                : null,
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
          }
          return null;
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          if (activeTasks === 0) {
            await maybeRestart();
          }
        }
      },
      async runQuantize(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (disabled && !(await ensurePool())) {
            if (crashLogger?.enabled) {
              crashLogger.logError({
                phase: 'worker-quantize',
                message: 'worker pool unavailable',
                stack: null,
                name: 'Error',
                code: null,
                task: 'quantizeVectors',
                payloadMeta: payload
                  ? {
                    vectorCount: Array.isArray(payload.vectors)
                      ? payload.vectors.length
                      : null,
                    levels: payload.levels ?? null
                  }
                  : null
              });
            }
            return null;
          }
          const result = await pool.run(payload, { name: 'quantizeVectors' });
          updatePoolMetrics();
          return result;
        } catch (err) {
          if (crashLogger?.enabled) {
            crashLogger.logError({
              phase: 'worker-quantize',
              message: err?.message || String(err),
              stack: err?.stack || null,
              name: err?.name || null,
              code: err?.code || null,
              task: 'quantizeVectors',
              payloadMeta: payload
                ? {
                  vectorCount: Array.isArray(payload.vectors) ? payload.vectors.length : null,
                  levels: payload.levels ?? null
                }
                : null,
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
          }
          return null;
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
          updatePoolMetrics();
          if (activeTasks === 0) {
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
