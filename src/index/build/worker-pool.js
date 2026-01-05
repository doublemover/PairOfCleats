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
    : os.cpus().length;
  const maxWorkersRaw = Number(raw.maxWorkers);
  const maxWorkers = Number.isFinite(maxWorkersRaw) && maxWorkersRaw > 0
    ? Math.max(1, Math.floor(maxWorkersRaw))
    : Math.max(1, Math.min(2, cpuLimit));
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
  return {
    enabled,
    maxWorkers,
    maxFileBytes,
    idleTimeoutMs,
    taskTimeoutMs,
    quantizeBatchSize
  };
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
  try {
    const pool = new Piscina({
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
    if (pool?.on && crashLogger?.enabled) {
      const formatPoolError = (err) => ({
        message: err?.message || String(err),
        stack: err?.stack || null,
        name: err?.name || null,
        code: err?.code || null,
        raw: util.inspect(err, { depth: 4, breakLength: 120, showHidden: true, getters: true })
      });
      pool.on('error', (err) => {
        crashLogger.logError({ phase: 'worker-pool', ...formatPoolError(err) });
      });
      pool.on('workerCreate', (worker) => {
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
    }
    return {
      config,
      pool,
      dictConfig: sanitizeDictConfig(dictConfig),
      shouldUseForFile(sizeBytes) {
        if (config.enabled === true) return true;
        if (config.enabled === 'auto') {
          if (config.maxFileBytes == null) return true;
          return !Number.isFinite(sizeBytes) || sizeBytes <= config.maxFileBytes;
        }
        return false;
      },
      async runTokenize(payload) {
        try {
          return await pool.run(payload, { name: 'tokenizeChunk' });
        } catch (err) {
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
          throw err;
        }
      },
      async runQuantize(payload) {
        try {
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
        }
      },
      async destroy() {
        await pool.destroy();
      }
    };
  } catch (err) {
    log(`Worker pool unavailable: ${err?.message || err}`);
    return null;
  }
}
