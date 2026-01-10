import os from 'node:os';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { log as defaultLog } from '../../shared/progress.js';

const normalizeEnabled = (raw) => {
  if (raw === true || raw === false) return raw;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'auto') return 'auto';
  return 'auto';
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
    dictConfig,
    postingsConfig,
    crashLogger = null,
    log = defaultLog
  } = input;
  const sanitizeDictConfig = (raw) => {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    return {
      segmentation: typeof cfg.segmentation === 'string' ? cfg.segmentation : 'auto',
      dpMaxTokenLength: Number.isFinite(Number(cfg.dpMaxTokenLength))
        ? Number(cfg.dpMaxTokenLength)
        : 32
    };
  };
  if (!config || config.enabled === false) return null;
  let Piscina;
  try {
    Piscina = (await import('piscina')).default;
  } catch (err) {
    log(`Worker pool unavailable (piscina missing): ${err?.message || err}`);
    return null;
  }
  const maxRestartAttempts = 3;
  const restartBaseDelayMs = 1000;
  const restartMaxDelayMs = 10000;
  try {
    let pool = null;
    let disabled = false;
    let restartAttempts = 0;
    let restartAtMs = 0;
    let restarting = null;
    let activeTasks = 0;
    let pendingRestart = false;
    const createPool = () => new Piscina({
      filename: fileURLToPath(new URL('./workers/indexer-worker.js', import.meta.url)),
      maxThreads: config.maxWorkers,
      idleTimeout: config.idleTimeoutMs,
      taskTimeout: config.taskTimeoutMs,
      workerData: {
        dictWords: Array.isArray(dictWords) ? dictWords : Array.from(dictWords || []),
        dictConfig: sanitizeDictConfig(dictConfig),
        postingsConfig: postingsConfig || {}
      }
    });
    const shutdownPool = async () => {
      if (!pool) return;
      try {
        await pool.destroy();
      } catch (err) {
        log(`Worker pool shutdown failed: ${err?.message || err}`);
      }
      pool = null;
    };
    const scheduleRestart = async (reason) => {
      if (!pool && disabled && restartAttempts > maxRestartAttempts) return;    
      disabled = true;
      restartAttempts += 1;
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
      if (!pendingRestart || !disabled) return false;
      if (activeTasks > 0) return false;
      if (Date.now() < restartAtMs) return false;
      return ensurePool();
    };
    const ensurePool = async () => {
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
            await scheduleRestart(`restart failed: ${err?.message || err}`);    
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
        mode: payload.mode,
        ext: payload.ext
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
      if (!poolInstance?.on || !crashLogger?.enabled) return;
      const formatPoolError = (err) => ({
        message: err?.message || String(err),
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
        worker.on('error', (err) => {
          crashLogger.logError({
            phase: 'worker-thread',
            threadId: worker.threadId,
            ...formatPoolError(err)
          });
        });
        worker.on('exit', (code) => {
          if (code === 0) return;
          crashLogger.logError({
            phase: 'worker-exit',
            threadId: worker.threadId,
            message: `worker exited with code ${code}`
          });
        });
      });
    };
    pool = createPool();
    attachPoolListeners(pool);
    return {
      config,
      get pool() {
        return pool;
      },
      dictConfig: sanitizeDictConfig(dictConfig),
      shouldUseForFile(sizeBytes) {
        if (disabled) return false;
        if (config.enabled === true) return true;
        if (config.enabled === 'auto') {
          if (config.maxFileBytes == null) return true;
          return !Number.isFinite(sizeBytes) || sizeBytes <= config.maxFileBytes;
        }
        return false;
      },
      async runTokenize(payload) {
        activeTasks += 1;
        try {
          if (disabled && !(await ensurePool())) return null;
          return await pool.run(sanitizePayload(payload), { name: 'tokenizeChunk' });
        } catch (err) {
          const isCloneError = err?.name === 'DataCloneError'
            || /could not be cloned|DataCloneError/i.test(err?.message || '');
          const detail = String(err?.message || err?.code || err?.name || err || '')
            .replace(/\s+/g, ' ')
            .trim();
          const reason = isCloneError
            ? 'data-clone error'
            : (detail ? `worker failure: ${detail}` : 'worker failure');
          await scheduleRestart(reason);
          if (crashLogger?.enabled) {
            crashLogger.logError({
              phase: 'worker-tokenize',
              message: err?.message || String(err),
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
          if (activeTasks === 0) {
            await maybeRestart();
          }
        }
      },
      async runQuantize(payload) {
        activeTasks += 1;
        try {
          if (disabled && !(await ensurePool())) {
            throw new Error('worker pool unavailable');
          }
          return await pool.run(payload, { name: 'quantizeVectors' });
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
          throw err;
        } finally {
          activeTasks = Math.max(0, activeTasks - 1);
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
    const pool = await createIndexerWorkerPool(input);
    const destroy = async () => {
      if (pool?.destroy) await pool.destroy();
    };
    return { tokenizePool: pool, quantizePool: pool, destroy };
  }
  const quantizeMaxWorkers = Number.isFinite(baseConfig.quantizeMaxWorkers)
    ? Math.max(1, Math.floor(baseConfig.quantizeMaxWorkers))
    : Math.max(1, Math.floor(baseConfig.maxWorkers / 2));
  const tokenizePool = await createIndexerWorkerPool(input);
  const quantizePool = await createIndexerWorkerPool({
    ...input,
    config: { ...baseConfig, maxWorkers: quantizeMaxWorkers }
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
