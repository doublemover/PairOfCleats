import { createError, ERROR_CODES } from '../../shared/error-codes.js';

/**
 * A finite fanout stops admissions at the first terminal observation. Started
 * searches retain their original signal and drain; stopping never aborts a
 * host-owned operation or releases its caches.
 *
 * @param {AbortSignal|null} signal
 */
export const createFederatedAdmission = (signal = null) => {
  let failure = null;
  let stopped = false;
  let rejectStopped;
  const whenStopped = new Promise((_, reject) => { rejectStopped = reject; });
  // A synchronous resolver/search can stop before the caller attaches its race.
  void whenStopped.catch(() => {});
  const stop = (error) => {
    if (!stopped) {
      stopped = true;
      failure = error;
      rejectStopped(error);
    }
    return failure;
  };
  const onAbort = () => stop(createError(ERROR_CODES.CANCELLED, 'Federated search cancelled.'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const accepting = () => {
    if (signal?.aborted && !stopped) onAbort();
    return !stopped;
  };
  accepting();
  return {
    accepting,
    stop,
    whenStopped,
    get failure() { return failure; },
    dispose: () => signal?.removeEventListener('abort', onAbort)
  };
};
