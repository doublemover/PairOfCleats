const resolveKeepaliveIntervalMs = (value) => (
  Number.isFinite(Number(value))
    ? Math.max(1, Math.floor(Number(value)))
    : 1000
);

/**
 * Create a referenced timer guard that keeps the event loop alive while a
 * promise-only wait is active.
 *
 * @param {{intervalMs?:number}} [options]
 * @returns {{start:()=>void,stop:()=>void}}
 */
export const createPromiseKeepalive = (options = {}) => {
  const intervalMs = resolveKeepaliveIntervalMs(options?.intervalMs);
  let timer = null;
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {}, intervalMs);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }
  };
};

/**
 * Keep the event loop referenced while awaiting a promise whose underlying work
 * may only be driven by unref'd timers or handles.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {{intervalMs?:number}} [options]
 * @returns {Promise<T>}
 */
export const awaitWithKeepalive = async (promise, options = {}) => {
  const keepalive = createPromiseKeepalive(options);
  keepalive.start();
  try {
    return await promise;
  } finally {
    keepalive.stop();
  }
};
