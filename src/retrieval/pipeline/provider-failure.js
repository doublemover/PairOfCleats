import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Fallback is allowed only after the original provider resource has settled.
 * Snapshot diagnostics once; arbitrary getters cannot replace its observer or
 * turn an inspection failure into an unavailable-backend success.
 */
export const observeRetrievalProviderFailure = primary => {
  const observation = observeStorageResource(primary, { phase: 'retrieval-provider-fallback' });
  observation.requireSettled();
  let code, name, message;
  try {
    code = observation.primary.code;
    name = observation.primary.name;
    message = observation.primary.message;
  } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return Object.freeze({
    abort: name === 'AbortError' || code === 'ABORT_ERR',
    code: typeof code === 'string' && code ? code : null,
    message: typeof message === 'string' ? message : null,
    requireSettled: observation.requireSettled,
    retain: observation.retain
  });
};

/** Both ANN routes honor the caller, then their own deadline, then an
 * independent provider abort, after retaining the original resource observer.
 */
export const observeAnnAttemptFailure = (error, { signal = null, timeout = null } = {}) => {
  const failure = observeRetrievalProviderFailure(error);
  throwIfAborted(signal);
  if (timeout?.aborted) return { ...failure, deadline: true };
  if (failure.abort) throw error;
  return { ...failure, deadline: false };
};
