import { createBoundedObjectPool } from '../../../../shared/bounded-object-pool.js';

/**
 * Create bounded object pools used by worker-pool telemetry and crash logging.
 *
 * @returns {object}
 */
export const createWorkerPoolMetaHelpers = () => {
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
  return {
    workerTaskMetricPool,
    tokenizePayloadMetaPool,
    quantizePayloadMetaPool,
    crashPayloadMetaPool,
    withPooledPayloadMeta,
    assignTokenizePayloadMeta,
    assignQuantizePayloadMeta
  };
};
