import { WORKER_CONTROL_BYTES, WORKER_OBSERVATION_VERSION, workerDataProperty } from './observation.js';

export const isWorkerFatalControl = value => workerDataProperty(value, 'type') === 'worker-fatal'
  && workerDataProperty(value, 'version') === WORKER_OBSERVATION_VERSION
  && ['uncaughtException', 'unhandledRejection'].includes(workerDataProperty(value, 'reason'))
  && Number.isSafeInteger(workerDataProperty(value, 'threadId')) && workerDataProperty(value, 'threadId') > 0;

/** Terminal control has fixed fields and no user error/source payload. Never await a log flush. */
export const installWorkerFatalPolicy = ({ threadId, send, observer, onPoison = () => {}, target = process }) => {
  let poisoned = false;
  const poison = (error, reason) => {
    if (poisoned) return;
    poisoned = true;
    try { onPoison(); } catch { /* default fatal exit remains authoritative */ }
    const control = { type: 'worker-fatal', version: WORKER_OBSERVATION_VERSION, threadId, reason };
    try { if (Buffer.byteLength(JSON.stringify(control)) <= WORKER_CONTROL_BYTES) send(control); } catch { /* exit does not depend on IPC */ }
    try { observer?.emit({ type: 'worker-crash', threadId, label: reason, error }); } catch { /* best effort */ }
  };
  // Monitor observes without installing a handler that suppresses Node's exit.
  const uncaught = error => poison(error, 'uncaughtException');
  // Be fatal even when an inherited Node launch selects rejection warning mode.
  // The thrown value stays original; nextTick deliberately enters default exit.
  const rejection = reason => {
    if (poisoned) return;
    poison(reason, 'unhandledRejection'); process.nextTick(() => { throw reason; });
  };
  target.on('uncaughtExceptionMonitor', uncaught);
  target.on('unhandledRejection', rejection);
  return {
    isPoisoned: () => poisoned,
    dispose() { target.off('uncaughtExceptionMonitor', uncaught); target.off('unhandledRejection', rejection); }
  };
};

export const createWorkerFatalError = (reason = 'worker fatal error') => Object.assign(
  new Error(`Indexer execution owner retired: ${reason}.`), { code: 'ERR_WORKER_FATAL' }
);
