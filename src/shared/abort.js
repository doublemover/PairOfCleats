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

export const isAbortSignal = (signal) => (
  Boolean(signal)
  && typeof signal.aborted === 'boolean'
  && typeof signal.addEventListener === 'function'
  && typeof signal.removeEventListener === 'function'
);

const INERT_ABORT_SIGNAL = Object.freeze({
  aborted: false,
  reason: undefined,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false
});

let sharedNeverAbortController = null;

export const coerceAbortSignal = (signal) => {
  if (isAbortSignal(signal)) return signal;
  if (typeof AbortController !== 'function') return INERT_ABORT_SIGNAL;
  if (!sharedNeverAbortController) {
    sharedNeverAbortController = new AbortController();
  }
  return sharedNeverAbortController.signal;
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

export const composeAbortSignals = (...inputs) => {
  const signals = inputs.flat().filter(isAbortSignal);
  if (signals.length === 0) return null;
  const alreadyAborted = signals.find((signal) => signal.aborted);
  if (alreadyAborted) {
    const controller = new AbortController();
    try {
      controller.abort(alreadyAborted.reason);
    } catch {
      controller.abort();
    }
    return controller.signal;
  }
  if (typeof AbortSignal?.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  const listeners = new Map();
  const cleanup = () => {
    for (const [signal, handler] of listeners.entries()) {
      try {
        signal.removeEventListener('abort', handler);
      } catch {}
    }
    listeners.clear();
  };
  for (const signal of signals) {
    const handler = () => {
      if (controller.signal.aborted) return;
      cleanup();
      try {
        controller.abort(signal.reason);
      } catch {
        controller.abort();
      }
    };
    listeners.set(signal, handler);
    signal.addEventListener('abort', handler, { once: true });
  }
  return controller.signal;
};
