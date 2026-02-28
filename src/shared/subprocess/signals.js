const TRACKED_SUBPROCESS_TERMINATION_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM']);

let trackedSubprocessHooksInstalled = false;
let trackedSubprocessShutdownTriggered = false;
let trackedSubprocessShutdownPromise = null;
const signalForwardInFlight = new Set();
let terminateTrackedSubprocessesRef = null;

/**
 * Trigger one-time tracked-child shutdown for process teardown paths.
 *
 * @param {string} reason
 * @returns {Promise<unknown>}
 */
const triggerTrackedSubprocessShutdown = (reason) => {
  if (trackedSubprocessShutdownTriggered) return trackedSubprocessShutdownPromise;
  trackedSubprocessShutdownTriggered = true;
  const terminate = terminateTrackedSubprocessesRef;
  trackedSubprocessShutdownPromise = (
    typeof terminate === 'function'
      ? terminate({ reason, force: true })
      : Promise.resolve(null)
  ).catch(() => null);
  return trackedSubprocessShutdownPromise;
};

const forwardSignalToDefault = (signal) => {
  const normalizedSignal = typeof signal === 'string' ? signal.trim() : '';
  if (!normalizedSignal || signalForwardInFlight.has(normalizedSignal)) return;
  signalForwardInFlight.add(normalizedSignal);
  try {
    process.kill(process.pid, normalizedSignal);
  } catch {}
  setImmediate(() => {
    signalForwardInFlight.delete(normalizedSignal);
  });
};

/**
 * Install process lifecycle hooks that flush tracked subprocesses before exit.
 *
 * Hooks include explicit termination signals so CI/job cancellation still runs
 * child cleanup even when Node would otherwise terminate by default handling.
 *
 * @param {(input:{reason?:string,force?:boolean}) => Promise<unknown>} terminateTrackedSubprocesses
 * @returns {void}
 */
const installTrackedSubprocessHooks = (terminateTrackedSubprocesses) => {
  if (typeof terminateTrackedSubprocesses === 'function') {
    terminateTrackedSubprocessesRef = terminateTrackedSubprocesses;
  }
  if (trackedSubprocessHooksInstalled) return;
  trackedSubprocessHooksInstalled = true;
  process.once('beforeExit', () => {
    void triggerTrackedSubprocessShutdown('process_before_exit');
  });
  process.once('exit', () => {
    void triggerTrackedSubprocessShutdown('process_exit');
  });
  process.on('uncaughtExceptionMonitor', () => {
    void triggerTrackedSubprocessShutdown('uncaught_exception');
  });
  for (const signal of TRACKED_SUBPROCESS_TERMINATION_SIGNALS) {
    try {
      process.once(signal, () => {
        const hasAdditionalSignalHandlers = process.listenerCount(signal) > 0;
        void triggerTrackedSubprocessShutdown(`signal_${String(signal || '').toLowerCase()}`)
          .finally(() => {
            if (!hasAdditionalSignalHandlers) {
              forwardSignalToDefault(signal);
            }
          });
      });
    } catch {}
  }
};

export { installTrackedSubprocessHooks };
