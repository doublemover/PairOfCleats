import { createTimeoutError, runWithTimeout } from './promise-timeout.js';

const toPositiveIntOr = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
};

const runTerminateWithTimeout = async (worker, timeoutMs) => {
  if (!worker || typeof worker.terminate !== 'function') {
    return { attempted: false, terminated: false };
  }
  if (timeoutMs <= 0) {
    try {
      await worker.terminate();
      return { attempted: true, terminated: true };
    } catch {
      return { attempted: true, terminated: false };
    }
  }
  try {
    await runWithTimeout(
      () => Promise.resolve(worker.terminate()),
      {
        timeoutMs,
        errorFactory: () => createTimeoutError({
          message: `[cleanup] worker terminate timed out after ${timeoutMs}ms.`,
          code: 'PISCINA_WORKER_TERMINATE_TIMEOUT',
          retryable: false
        })
      }
    );
    return { attempted: true, terminated: true };
  } catch {
    return { attempted: true, terminated: false };
  }
};

const snapshotPoolThreads = (pool) => {
  if (!pool || !Array.isArray(pool.threads)) return [];
  return pool.threads.filter(Boolean);
};

/**
 * Best-effort hard-stop for Piscina worker threads.
 *
 * @param {object|null} pool
 * @param {{label?:string,log?:(line:string)=>void,terminateTimeoutMs?:number}} [options]
 * @returns {Promise<{attempted:number,terminated:number,failed:number}>}
 */
export const forceTerminatePiscinaThreads = async (pool, options = {}) => {
  const label = typeof options.label === 'string' && options.label.trim()
    ? options.label.trim()
    : 'piscina';
  const log = typeof options.log === 'function' ? options.log : null;
  const terminateTimeoutMs = toPositiveIntOr(options.terminateTimeoutMs, 5000);
  const threads = snapshotPoolThreads(pool);
  if (!threads.length) {
    return { attempted: 0, terminated: 0, failed: 0 };
  }
  const results = await Promise.all(threads.map((thread) => runTerminateWithTimeout(thread, terminateTimeoutMs)));
  let attempted = 0;
  let terminated = 0;
  for (const result of results) {
    if (!result?.attempted) continue;
    attempted += 1;
    if (result.terminated) terminated += 1;
  }
  const failed = Math.max(0, attempted - terminated);
  if (log) {
    log(
      `[cleanup] ${label} force-terminate workers: attempted=${attempted}, ` +
      `terminated=${terminated}, failed=${failed}.`
    );
  }
  return { attempted, terminated, failed };
};

/**
 * Destroy a Piscina pool with timeout + hard-stop fallback.
 *
 * @param {object|null} pool
 * @param {{label?:string,log?:(line:string)=>void,destroyTimeoutMs?:number,terminateTimeoutMs?:number}} [options]
 * @returns {Promise<{skipped:boolean,timedOut:boolean,forced:boolean,forcedSummary?:{attempted:number,terminated:number,failed:number}}>}
 */
export const destroyPiscinaPool = async (pool, options = {}) => {
  const label = typeof options.label === 'string' && options.label.trim()
    ? options.label.trim()
    : 'piscina';
  const log = typeof options.log === 'function' ? options.log : null;
  const destroyTimeoutMs = toPositiveIntOr(options.destroyTimeoutMs, 30000);
  const terminateTimeoutMs = toPositiveIntOr(options.terminateTimeoutMs, 5000);
  if (!pool || typeof pool.destroy !== 'function') {
    return { skipped: true, timedOut: false, forced: false };
  }
  try {
    await runWithTimeout(
      () => pool.destroy(),
      {
        timeoutMs: destroyTimeoutMs,
        errorFactory: () => createTimeoutError({
          message: `[cleanup] ${label} destroy timed out after ${destroyTimeoutMs}ms.`,
          code: 'PISCINA_DESTROY_TIMEOUT',
          retryable: false,
          meta: {
            label,
            destroyTimeoutMs
          }
        })
      }
    );
    return { skipped: false, timedOut: false, forced: false };
  } catch (error) {
    if (error?.code !== 'PISCINA_DESTROY_TIMEOUT') throw error;
    if (log) {
      log(
        `[cleanup] ${label} destroy timed out after ${destroyTimeoutMs}ms; ` +
        'forcing worker termination.'
      );
    }
    const forcedSummary = await forceTerminatePiscinaThreads(pool, {
      label,
      log,
      terminateTimeoutMs
    });
    if (forcedSummary.failed > 0) {
      const terminateError = createTimeoutError({
        message: `[cleanup] ${label} force-terminate incomplete: failed=${forcedSummary.failed}.`,
        code: 'PISCINA_FORCE_TERMINATE_INCOMPLETE',
        retryable: false,
        meta: {
          label,
          destroyTimeoutMs,
          terminateTimeoutMs,
          forcedSummary
        }
      });
      throw terminateError;
    }
    return {
      skipped: false,
      timedOut: true,
      forced: forcedSummary.attempted > 0,
      forcedSummary
    };
  }
};
