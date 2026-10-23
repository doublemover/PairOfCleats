import { isAbortError, throwIfAborted } from '../../../../../shared/abort.js';

export const REQUEST_NOT_ADMITTED = Symbol('LSP request not admitted');

/** All interactive methods share this queued-to-running boundary. Requested
 * counters and request budget describe admitted guard attempts; client metrics
 * separately describe actual transport requests. Cache hits never enqueue.
 */
export const createInteractiveRequestAdmission = ({ signal, fileStats, metrics,
  isDeadlineExpired, markDeadlineReached, recordDeadlineSkip, reserveBudget }) => {
  const count = key => { fileStats[key] += 1; metrics[key] += 1; };
  return ({ limiter, budget, requestedMetric, run }) => {
    count('queueEnqueued');
    let admitted = false;
    return limiter(() => {
      throwIfAborted(signal);
      if (isDeadlineExpired()) {
        markDeadlineReached(); recordDeadlineSkip();
        return REQUEST_NOT_ADMITTED;
      }
      if (!reserveBudget(budget)) return REQUEST_NOT_ADMITTED;
      admitted = true;
      count('queueStarted'); count(requestedMetric);
      return run();
    }, { signal }).catch(error => {
      if (!admitted && isAbortError(error)) count('queueCancelled');
      throw error;
    });
  };
};
