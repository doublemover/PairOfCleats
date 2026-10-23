// Existing process-local producer associations shared by the publication and
// release owners. No filesystem admission, resource registry or path authority.
const publicationOwners = new WeakMap(), wrapperFailures = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

export const isFileLockPublicationFailureForSession = (failure, session) => {
  const producer = objectLike(failure) ? publicationOwners.get(failure) : null;
  return producer?.failure === true && producer.session === session;
};
export const recordFileLockPublicationFailure = (failure, session) => {
  publicationOwners.set(failure, { session, failure: true });
};
export const recordPublishedFileLockHandle = (lock, { session, remember, releaseObservation }) => {
  publicationOwners.set(lock, { session, remember, releaseObservation });
};

// Observations describe independent prerequisites, never metadata settlement.
export const getPublishedFileLockReleaseObservation = lock => objectLike(lock)
  ? publicationOwners.get(lock)?.releaseObservation || null : null;
export const isFileLockPublicationFailureFor = (failure, lock) => {
  const actual = objectLike(lock) ? publicationOwners.get(lock) : null;
  const producer = objectLike(failure) ? publicationOwners.get(failure) : null;
  return Boolean(actual?.releaseObservation && producer?.failure === true && actual.session === producer.session);
};

// Read only the actual wrapper's captured independent observer for its exact
// handle. Serialized fields, causes or another handle never authenticate it.
export const getFileLockReleaseFailureObservation = (failure, lock) => {
  const state = objectLike(failure) ? wrapperFailures.get(failure) : null;
  return state && state.lock === lock ? state.observe : null;
};
export const recordFileLockReleaseWrapperFailure = (failure, lock, observe) => {
  const actual = objectLike(lock) ? publicationOwners.get(lock) : null;
  if (!actual?.releaseObservation || !objectLike(failure) || typeof observe !== 'function') return false;
  wrapperFailures.set(failure, { lock, observe });
  // Return new independent worker/inspection/native observations to this same
  // existing metadata owner before another explicit operation is admitted.
  actual.remember(failure);
  return true;
};
