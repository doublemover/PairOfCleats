import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { log as defaultLog } from '../../../shared/progress.js';
import {
  incWorkerRetries,
  observeWorkerTaskDuration,
  setWorkerActiveTasks,
  setWorkerQueueDepth
} from '../../../shared/metrics.js';
import {
  buildWorkerExecArgv,
  resolveMemoryWorkerCap,
  resolveWorkerResourceLimits
} from './config.js';
import { sanitizePoolPayload, summarizeError } from './protocol.js';

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
    let shutdownWhenIdle = false;
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
        filename: fileURLToPath(new URL('./indexer-worker.js', import.meta.url)),
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
      async tokenizeChunk(payload) {
        activeTasks += 1;
        updatePoolMetrics();
        try {
          if (disabled && !(await ensurePool())) {
            if (crashLogger?.enabled) {
              crashLogger.logError({
                phase: 'worker-tokenize',
                message: 'worker pool unavailable',
                stack: null,
                name: 'Error',
                code: null,
                task: 'tokenizeChunk',
                payloadMeta: payload
                  ? {
                    file: typeof payload.file === 'string' ? payload.file : null,
                    size: Number.isFinite(payload.size) ? payload.size : null,
                    textLength: typeof payload.text === 'string' ? payload.text.length : null,
                    mode: payload.mode || null,
                    ext: payload.ext || null
                  }
                  : null
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
            if (shutdownWhenIdle) {
              shutdownWhenIdle = false;
              await shutdownPool();
            }
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
          const transferList = [];
          if (Array.isArray(payload?.vectors)) {
            for (const vec of payload.vectors) {
              if (ArrayBuffer.isView(vec) && !(vec instanceof DataView)) {
                if (vec.byteOffset === 0 && vec.byteLength === vec.buffer.byteLength) {
                  transferList.push(vec.buffer);
                }
              }
            }
          }
          const runOptions = transferList.length
            ? { name: 'quantizeVectors', transferList }
            : { name: 'quantizeVectors' };
          const result = await pool.run(payload, runOptions);
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
