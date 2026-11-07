import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Join exactly two independent builds before the caller can retire their
 * worlds. This does not establish resource closure: original child/storage
 * observations remain the caller's prerequisites. No retries or new timeout
 * policy; both operations use the existing run's shared cancellation/deadline.
 */
export const settleIndexBuildPair = async (candidate, rebuild) => {
  if (typeof candidate !== 'function' || typeof rebuild !== 'function') throw new TypeError('Two original build operations are required.');
  const outcomes = await Promise.allSettled([Promise.resolve().then(candidate), Promise.resolve().then(rebuild)]);
  const failures = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
  if (failures.length) {
    let failure = failures[0];
    for (const secondary of failures.slice(1)) failure = addStorageFailureContext(failure, {}, secondary,
      { secondaryPresent: true, forceAggregate: true, ownerMessage: 'Both original index-build worlds failed.' });
    throw failure;
  }
  return outcomes.map(outcome => outcome.value);
};
