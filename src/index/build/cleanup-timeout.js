import { createTimeoutError, runWithTimeout } from '../../shared/promise-timeout.js';

export const DEFAULT_BUILD_CLEANUP_TIMEOUT_MS = 30_000;

const coerceOptionalNonNegativeInt = (value) => {
  // Treat nullish/empty/boolean inputs as "unset" so layered defaults can win.
  // Coercing these to 0 would accidentally disable timeout enforcement.
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

/**
 * Resolve cleanup timeout from layered candidates.
 *
 * First valid non-negative integer wins. `0` disables timeout enforcement.
 *
 * @param  {...unknown} values
 * @returns {number}
 */
export const resolveBuildCleanupTimeoutMs = (...values) => {
  for (const value of values) {
    const parsed = coerceOptionalNonNegativeInt(value);
    if (parsed != null) return parsed;
  }
  return DEFAULT_BUILD_CLEANUP_TIMEOUT_MS;
};

/**
 * Run teardown/cleanup work with bounded timeout.
 *
 * Timeout errors are optionally swallowed so callers can continue shutdown.
 *
 * @param {{
 *   label?:string,
 *   cleanup?:Function,
 *   timeoutMs?:number,
 *   log?:(line:string)=>void,
 *   onTimeout?:(err:Error)=>Promise<void>|void,
 *   swallowTimeout?:boolean
 * }} [input]
 * @returns {Promise<{skipped:boolean,timedOut:boolean,elapsedMs:number,error?:Error}>}
 */
export const runBuildCleanupWithTimeout = async ({
  label = 'cleanup',
  cleanup = null,
  timeoutMs = DEFAULT_BUILD_CLEANUP_TIMEOUT_MS,
  log = null,
  onTimeout = null,
  swallowTimeout = true
} = {}) => {
  if (typeof cleanup !== 'function') {
    return { skipped: true, timedOut: false, elapsedMs: 0 };
  }
  const resolvedTimeoutMs = resolveBuildCleanupTimeoutMs(timeoutMs);
  const startedAtMs = Date.now();
  if (!Number.isFinite(resolvedTimeoutMs) || resolvedTimeoutMs <= 0) {
    await cleanup();
    return {
      skipped: false,
      timedOut: false,
      elapsedMs: Math.max(0, Date.now() - startedAtMs)
    };
  }
  try {
    await runWithTimeout(
      () => cleanup(),
      {
        timeoutMs: resolvedTimeoutMs,
        errorFactory: () => createTimeoutError({
          message: `[cleanup] ${label} timed out after ${resolvedTimeoutMs}ms.`,
          code: 'BUILD_CLEANUP_TIMEOUT',
          retryable: false,
          meta: {
            label,
            timeoutMs: resolvedTimeoutMs
          }
        })
      }
    );
    return {
      skipped: false,
      timedOut: false,
      elapsedMs: Math.max(0, Date.now() - startedAtMs)
    };
  } catch (error) {
    if (error?.code !== 'BUILD_CLEANUP_TIMEOUT') throw error;
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    if (typeof log === 'function') {
      try {
        log(`[cleanup] ${label} timed out after ${resolvedTimeoutMs}ms; continuing.`);
      } catch {}
    }
    if (typeof onTimeout === 'function') {
      try {
        await onTimeout(error);
      } catch {}
    }
    if (!swallowTimeout) throw error;
    return {
      skipped: false,
      timedOut: true,
      elapsedMs,
      error
    };
  }
};
