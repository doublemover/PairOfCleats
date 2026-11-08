import { observeStorageResource } from '../../shared/storage/failure-observation.js';

const retain = (errors, observations) => {
  let failure = errors.length === 1 ? errors[0]
    : new AggregateError(errors, 'Search execution and cleanup did not both complete.', { cause: errors[0] });
  for (const observation of observations) {
    if (observation.hasResourceObservation) failure = observation.wrap(failure);
  }
  return failure;
};

/** One request owns cleanup before publication and on every failure path.
 * Cleanup never replays; independent reporting/cache work still gets its turn.
 */
export const createSearchSettlement = ({ dispose, after = [] }) => {
  let cleanup = null, failed = false, primary, primaryObservation;
  const finish = () => cleanup ||= Promise.resolve().then(async () => {
    const errors = [], observations = [];
    for (const action of [dispose, ...after]) {
      try { await action(); }
      catch (error) {
        observations.push(observeStorageResource(error, { phase: 'search-request-settlement' }));
        errors.push(error);
      }
    }
    if (errors.length) throw retain(errors, observations);
  });
  return Object.freeze({
    beforePublish: finish,
    captureFailure(error) {
      if (failed) return;
      failed = true; primary = error;
      primaryObservation = observeStorageResource(error, { phase: 'search-request-work' });
    },
    async settle() {
      try { await finish(); }
      catch (error) {
        if (!failed || Object.is(primary, error)) throw error;
        throw retain([primary, error], [primaryObservation,
          observeStorageResource(error, { phase: 'search-request-cleanup' })]);
      }
    }
  });
};
