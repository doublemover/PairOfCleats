const toPositiveTimeoutMs = (value, fallbackMs = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.max(0, Math.floor(Number(fallbackMs) || 0));
  }
  return Math.floor(numeric);
};

/**
 * Build a typed timeout error used by long-running async guards.
 *
 * @param {{message?:string,code?:string,retryable?:boolean,meta?:object}} [input]
 * @returns {Error}
 */
export const createTimeoutError = (input = {}) => {
  const message = typeof input.message === 'string' && input.message.trim()
    ? input.message
    : 'Operation timed out';
  const err = new Error(message);
  err.code = typeof input.code === 'string' && input.code.trim()
    ? input.code.trim()
    : 'ERR_TIMEOUT';
  if (typeof input.retryable === 'boolean') {
    err.retryable = input.retryable;
  }
  if (input.meta && typeof input.meta === 'object') {
    err.meta = input.meta;
  }
  return err;
};

/**
 * Resolve an async operation with a hard timeout.
 *
 * @template T
 * @param {() => Promise<T>|T} operation
 * @param {{timeoutMs:number,errorFactory?:() => Error}} input
 * @returns {Promise<T>}
 */
export const runWithTimeout = async (operation, input = {}) => {
  const timeoutMs = toPositiveTimeoutMs(input.timeoutMs, 0);
  if (timeoutMs <= 0) {
    return Promise.resolve().then(operation);
  }
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = typeof input.errorFactory === 'function'
          ? input.errorFactory()
          : createTimeoutError();
        reject(timeoutError);
      }, timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

