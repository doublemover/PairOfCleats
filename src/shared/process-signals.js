/**
 * Attach cleanup handlers for process signals without accidentally becoming the
 * sole reason Node stops honoring default signal termination.
 *
 * When no external listeners were present for a signal before registration,
 * re-emit the signal after cleanup so the default termination behavior still
 * occurs. Callers may inject a custom re-emitter for deterministic tests.
 *
 * @param {{
 *   cleanup?:(signal:string)=>void,
 *   signals?:string[]|null,
 *   preserveDefaultTermination?:boolean,
 *   reemitSignal?:(signal:string)=>void
 * }} [options]
 * @returns {() => void}
 */
export function attachCleanupSignalHandlers({
  cleanup = null,
  signals = null,
  preserveDefaultTermination = true,
  reemitSignal = null
} = {}) {
  const events = Array.isArray(signals) && signals.length > 0
    ? signals
    : ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  const handlers = [];
  let detached = false;
  const emitSignal = typeof reemitSignal === 'function'
    ? reemitSignal
    : (signal) => process.kill(process.pid, signal);

  const detach = () => {
    if (detached) return;
    detached = true;
    for (const { event, handler } of handlers) {
      process.off(event, handler);
    }
    handlers.length = 0;
  };

  for (const event of events) {
    const handler = () => {
      const shouldReemit = preserveDefaultTermination
        && !process.rawListeners(event).some((entry) => entry !== handler && entry?.listener !== handler);
      try {
        cleanup?.(event);
      } finally {
        detach();
        if (shouldReemit) {
          emitSignal(event);
        }
      }
    };
    process.prependOnceListener(event, handler);
    handlers.push({ event, handler });
  }

  return detach;
}
