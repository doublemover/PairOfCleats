import { createWarnOnce } from '../logging/warn-once.js';

/**
 * Shared warn-once emitter for json-stream runtime warnings.
 *
 * @type {(key:string,message:string)=>void}
 */
const warnOnce = createWarnOnce({
  logger: (message) => {
    try {
      process.stderr.write(`${message}\n`);
    } catch {}
  }
});

/**
 * Create standardized abort error used by stream/runtime helpers.
 *
 * @returns {Error & {code:string}}
 */
const createAbortError = () => {
  const err = new Error('Operation aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
};

/**
 * Throw standardized abort error when signal is already aborted.
 *
 * @param {AbortSignal|null|undefined} signal
 * @returns {void}
 */
const throwIfAborted = (signal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const waitForImmediate = () => new Promise((resolve) => setImmediate(resolve));

const resolvePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
};

/**
 * Build a cooperative yielder that periodically yields back to the event loop.
 * This keeps timers/heartbeats responsive while streaming very large payloads.
 *
 * @param {{every?:number,minIntervalMs?:number}} [input]
 * @returns {()=>Promise<void>}
 */
const createCooperativeYielder = (input = {}) => {
  const every = resolvePositiveInt(input?.every, 2048);
  const minIntervalMs = resolvePositiveInt(input?.minIntervalMs, 8);
  let steps = 0;
  let lastYieldAt = Date.now();
  return async () => {
    steps += 1;
    if ((steps % every) !== 0) return;
    const now = Date.now();
    if ((now - lastYieldAt) < minIntervalMs) return;
    lastYieldAt = now;
    await waitForImmediate();
  };
};

export { warnOnce, createAbortError, throwIfAborted, createCooperativeYielder };
