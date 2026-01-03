import os from 'node:os';
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
    log = defaultLog
  } = input;
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
        dictConfig: dictConfig || {},
        postingsConfig: postingsConfig || {}
      }
    });
    return {
      config,
      pool,
      shouldUseForFile(sizeBytes) {
        if (config.enabled === true) return true;
        if (config.enabled === 'auto') {
          if (config.maxFileBytes == null) return true;
          return !Number.isFinite(sizeBytes) || sizeBytes <= config.maxFileBytes;
        }
        return false;
      },
      async runTokenize(payload) {
        return pool.run(payload, { name: 'tokenizeChunk' });
      },
      async runQuantize(payload) {
        return pool.run(payload, { name: 'quantizeVectors' });
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
