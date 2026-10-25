const SIGNAL_DISPATCH_TIMEOUT_MS = 3000;

/**
 * Keep the process alive until a self-signal reaches its existing handlers.
 * With no handlers, the operating system retains default signal authority.
 * A missed dispatch must fail closed rather than turn a child failure into 0.
 *
 * @param {string} signal
 * @returns {void}
 */
export const dispatchSelfSignal = (signal) => {
  let observer = null;
  const timeout = setTimeout(() => {
    if (observer) process.off(signal, observer);
    process.exit(1);
  }, SIGNAL_DISPATCH_TIMEOUT_MS);
  const release = () => clearTimeout(timeout);
  try {
    if (process.listenerCount(signal) > 0) {
      // Remove this observer before any existing cleanup handler inspects the
      // remaining listeners to decide who owns default termination.
      observer = release;
      process.prependOnceListener(signal, observer);
    }
    process.kill(process.pid, signal);
  } catch (error) {
    release();
    if (observer) process.off(signal, observer);
    throw error;
  }
};
