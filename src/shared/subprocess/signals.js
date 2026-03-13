const TRACKED_SUBPROCESS_TERMINATION_SIGNALS = Object.freeze([
  'SIGINT',
  'SIGTERM',
  'SIGBREAK',
  'SIGHUP'
]);
const SIGNAL_FORWARD_TIMEOUT_MS = 3000;

let trackedSubprocessHooksInstalled = false;
let trackedSubprocessShutdownTriggered = false;
let trackedSubprocessShutdownPromise = null;
const signalForwardInFlight = new Set();
let terminateTrackedSubprocessesRef = null;
let terminateTrackedSubprocessesSyncRef = null;

/**
 * Trigger tracked-child shutdown for process teardown paths.
 *
 * @param {string} reason
 * @param {{allowRepeat?:boolean}} [options]
 * @returns {Promise<unknown>}
 */
const triggerTrackedSubprocessShutdown = (reason, { allowRepeat = false } = {}) => {
  if (trackedSubprocessShutdownTriggered) return trackedSubprocessShutdownPromise;
  trackedSubprocessShutdownTriggered = true;
  const terminate = terminateTrackedSubprocessesRef;
  trackedSubprocessShutdownPromise = (
    typeof terminate === 'function'
      ? terminate({ reason, force: true })
      : Promise.resolve(null)
  ).catch(() => null);
  trackedSubprocessShutdownPromise.finally(() => {
    // Keep hooks reusable even when beforeExit fired early and process continued.
    // `allowRepeat` is retained for callsite compatibility.
    void allowRepeat;
    trackedSubprocessShutdownTriggered = false;
    trackedSubprocessShutdownPromise = null;
  });
  return trackedSubprocessShutdownPromise;
};

const triggerTrackedSubprocessShutdownSync = (reason) => {
  const terminateSync = terminateTrackedSubprocessesSyncRef;
  if (typeof terminateSync !== 'function') return null;
  try {
    return terminateSync({ reason, force: true });
  } catch {
    return null;
  }
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
 * @param {(input:{reason?:string,force?:boolean}) => unknown} [terminateTrackedSubprocessesSync]
 * @returns {void}
 */
const installTrackedSubprocessHooks = (terminateTrackedSubprocesses, terminateTrackedSubprocessesSync = null) => {
  if (typeof terminateTrackedSubprocesses === 'function') {
    terminateTrackedSubprocessesRef = terminateTrackedSubprocesses;
  }
  if (typeof terminateTrackedSubprocessesSync === 'function') {
    terminateTrackedSubprocessesSyncRef = terminateTrackedSubprocessesSync;
  }
  if (trackedSubprocessHooksInstalled) return;
  trackedSubprocessHooksInstalled = true;
  process.once('beforeExit', () => {
    // Keep beforeExit non-blocking; synchronous tree-kill can stall normal closeout.
    void triggerTrackedSubprocessShutdown('process_before_exit');
  });
  process.once('exit', () => {
    triggerTrackedSubprocessShutdownSync('process_exit');
  });
  process.on('uncaughtExceptionMonitor', () => {
    triggerTrackedSubprocessShutdownSync('uncaught_exception');
    void triggerTrackedSubprocessShutdown('uncaught_exception');
  });
  for (const signal of TRACKED_SUBPROCESS_TERMINATION_SIGNALS) {
    try {
      process.once(signal, () => {
        const hasAdditionalSignalHandlers = process.listenerCount(signal) > 0;
        const forwardSignal = () => {
          if (!hasAdditionalSignalHandlers) {
            forwardSignalToDefault(signal);
          }
        };
        const timeout = setTimeout(() => {
          forwardSignal();
        }, SIGNAL_FORWARD_TIMEOUT_MS);
        timeout.unref?.();
        void triggerTrackedSubprocessShutdown(`signal_${String(signal || '').toLowerCase()}`, {
          allowRepeat: true
        })
          .finally(() => {
            clearTimeout(timeout);
            forwardSignal();
          });
      });
    } catch {}
  }
};

export { installTrackedSubprocessHooks };
