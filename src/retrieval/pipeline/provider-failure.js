import { observeStorageResource } from '../../shared/storage/failure-observation.js';

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
