import { resolveRepoCacheRootPath } from '../../../shared/repo-paths.js';
import { acquireIndexStorageSession } from '../storage-session.js';
import { isStorageSessionReleaseFailure } from '../../../shared/storage/session.js';
import { createRuntimeFailure } from './failure.js';

const owners = new WeakMap();
const retainedErrors = new WeakMap();
const pendingObserver = (error, inspectionErrors = []) => {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch (failure) { inspectionErrors.push(failure); return () => false; }
};

/** Admission precedes runtime logger/cache/native initialization. Resolution
 * uses the actual effective config, not a parent inferred from a build path.
 */
export const acquireBuildRuntimeStorage = (root, userConfig) => {
  const owner = acquireIndexStorageSession(resolveRepoCacheRootPath(root, userConfig), { repoRoot: root, userConfig });
  owners.set(owner, { released: false, initializationClosed: false, pending: new Map(), unknownPending: false, inspectionErrors: [] });
  return owner;
};

const release = owner => {
  const state = owners.get(owner);
  if (!state) throw new TypeError('Build runtime storage requires its actual admitted owner.');
  if (state.released) return true;
  if (state.unknownPending || [...state.pending.values()].some(observe => !observe())) {
    throw Object.assign(new Error('Independent runtime resource settlement remains unconfirmed.'), { code: 'ERR_INDEX_RUNTIME_STORAGE_PENDING' });
  }
  const { session } = owner;
  if (session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }) !== true) {
    throw new Error('Build runtime storage session did not confirm release.');
  }
  state.released = true;
  return true;
};

const rememberFailure = (error, owner, originalObservation = null) => {
  const state = owners.get(owner);
  if (!state) throw new TypeError('Build runtime storage requires its actual admitted owner.');
  if (retainedErrors.get(error) === owner || state.pending.has(error) || isStorageSessionReleaseFailure(error, owner.session)) return;
  const inspectionErrors = [];
  const observe = originalObservation || pendingObserver(error, inspectionErrors);
  if (observe) {
    if (state.pending.size >= 128) state.unknownPending = true;
    else state.pending.set(error, observe);
  }
  for (const failure of inspectionErrors) {
    if (state.inspectionErrors.length < 128) state.inspectionErrors.push(failure);
    else state.unknownPending = true;
  }
};

const retainedFailure = (error, owner, { cleanupError, cleanupFailed = false, runtime = null,
  originalObservations = [] } = {}) => {
  const capturedErrors = new Set(originalObservations.map(observation => observation.error));
  const independentObservations = originalObservations.filter(observation => retainedErrors.get(observation.error) !== owner
    && !isStorageSessionReleaseFailure(observation.error, owner.session));
  for (const observation of independentObservations) rememberFailure(observation.error, owner, observation.observe);
  // The teardown aggregate is composed only from these captured originals. Its
  // public closure may include this exact owner's earlier outward failure; do
  // not turn that diagnostic into a self-settlement prerequisite.
  if (!originalObservations.length) rememberFailure(error, owner);
  if (cleanupFailed) rememberFailure(cleanupError, owner);
  const state = owners.get(owner);
  const failure = createRuntimeFailure(error, { cleanupError, cleanupFailed,
    additionalErrors: [...state.inspectionErrors, ...independentObservations.map(observation => observation.context)] });
  // Diagnostic inspection can itself fail with an independent resource owner.
  // Capture each original observation before exposing the aggregate.
  for (const original of failure.errors) {
    if (originalObservations.length && (original === error || capturedErrors.has(original))) continue;
    rememberFailure(original, owner);
  }
  for (const original of state.inspectionErrors) if (!failure.errors.includes(original)) failure.errors.push(original);
  if (!Object.hasOwn(failure, 'code')) Object.defineProperty(failure, 'code', { value: 'ERR_INDEX_RUNTIME_STORAGE_PENDING', enumerable: true });
  Object.defineProperties(failure, {
    cacheOwnershipPending: { value: true, enumerable: true },
    cacheOwnershipReleased: { value: () => state.released && !state.unknownPending && [...state.pending.values()].every(observe => observe()) },
    storageSession: { value: owner.session }, buildRuntimeStorage: { value: owner },
    ...(runtime ? { buildRuntime: { value: runtime } } : {})
  });
  retainedErrors.set(failure, owner);
  return failure;
};

/** Only the actual runtime teardown calls this after all of its resource steps
 * finish. A failed step retains the category even when other steps succeeded.
 */
export const retainBuildRuntimeStorageFailure = (runtime, error, {
  originalObservations = [], unownedFailure = error
} = {}) => {
  const owner = runtime?.indexRuntimeStorage;
  return owners.has(owner) ? retainedFailure(error, owner, { runtime, originalObservations }) : unownedFailure;
};

export const releaseBuildRuntimeStorage = runtime => {
  const owner = runtime?.indexRuntimeStorage;
  if (!owner) return;
  if (!owners.has(owner)) throw new TypeError('Build runtime storage requires its actual admitted owner.');
  try { release(owner); }
  catch (error) { throw retainedFailure(error, owner, { runtime }); }
};

/** The existing registry unwinds every acquired initialization owner. Its
 * rejection or an independent pending primary prevents category release.
 */
export const closeBuildRuntimeInitialization = async ({ initialization, error, owner = null }) => {
  let cleanupError, cleanupFailed = false;
  try { await initialization.close(); } catch (failure) { cleanupError = failure; cleanupFailed = true; }
  if (!owner) {
    return cleanupFailed ? createRuntimeFailure(error, { cleanupError, cleanupFailed }) : error;
  }
  rememberFailure(error, owner);
  const state = owners.get(owner);
  const observe = state.pending.get(error);
  if (cleanupFailed || state.unknownPending || (observe && !observe())) return retainedFailure(error, owner, { cleanupError, cleanupFailed });
  // Failure receipt persistence still writes this category after unwind. The
  // outer receipt owner finalizes admission only after that write settles.
  owners.get(owner).initializationClosed = true;
  return error;
};

export const finalizeBuildRuntimeInitializationFailure = ({ error, recordingError, recordingFailed = recordingError !== null && recordingError !== undefined, owner = null }) => {
  if (!owner) {
    return recordingFailed ? createRuntimeFailure(error, { cleanupError: recordingError, cleanupFailed: true }) : error;
  }
  if (recordingFailed || owners.get(owner)?.initializationClosed !== true) {
    return retainedFailure(error, owner, { cleanupError: recordingError, cleanupFailed: recordingFailed });
  }
  try { release(owner); } catch (failure) { return retainedFailure(error, owner, { cleanupError: failure, cleanupFailed: true }); }
  return error;
};
