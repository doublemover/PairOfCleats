import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

/** Build one awaited, idempotent cleanup for request-owned backend resources. */
export const createBackendDisposer = (disposers = new Set()) => {
  let pending = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const errors = [], observations = [];
        for (const dispose of disposers) {
          const outcomes = [];
          try {
            const invocation = dispose();
            outcomes.push(observeStorageResource(invocation, { phase: 'search-backend-close-invocation' }));
            const result = await invocation;
            if (result !== invocation) outcomes.push(observeStorageResource(result, { phase: 'search-backend-close-result' }));
            for (const outcome of outcomes) outcome.requireSettled();
          } catch (error) {
            // Capture before a sibling disposer can alter report callbacks.
            observations.push(observeStorageResource(error, { phase: 'search-backend-disposal' }));
            let failure = error;
            for (const outcome of outcomes) {
              if (outcome.hasResourceObservation) failure = outcome.wrap(failure);
            }
            observations.push(...outcomes);
            errors.push(failure);
          }
        }
        disposers.clear();
        if (errors.length) {
          let failure = new AggregateError(errors, 'Search backend cleanup failed.', { cause: errors[0] });
          for (const error of errors) failure = addStorageFailureContext(failure, {}, error,
            { secondaryPresent: true, forceAggregate: true });
          failure = addStorageFailureContext(failure, { cacheOwnershipPending: true,
            cacheOwnershipReleased: () => observations.every(observation => {
              try { return observation.isSettled(); } catch { return false; }
            }) }, null, { forceAggregate: true });
          throw failure;
        }
      });
    }
    return pending;
  };
};
