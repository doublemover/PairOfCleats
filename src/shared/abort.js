export const createAbortError = (message = 'Operation aborted') => {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
};

export const isAbortError = (error) => {
  if (!error || typeof error !== 'object') return false;
  return error.name === 'AbortError' || error.code === 'ABORT_ERR';
};

export const throwIfAborted = (signal, message) => {
  if (!signal || !signal.aborted) return;
  throw createAbortError(message);
};

export const raceAbort = (signal, promise, message) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError(message));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createAbortError(message));
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
};

export const createAbortControllerWithHandlers = () => {
  const controller = new AbortController();
  const handlers = new Set();
  const onAbort = (handler) => {
    if (typeof handler !== 'function') return () => {};
    handlers.add(handler);
    if (controller.signal.aborted) {
      handler(controller.signal.reason);
    }
    return () => {
      handlers.delete(handler);
    };
  };
  const abort = (reason) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    for (const handler of handlers) {
      try {
        handler(reason);
      } catch {}
    }
  };
  return {
    controller,
    signal: controller.signal,
    abort,
    onAbort
  };
};
