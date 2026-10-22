import { resolveRepoCacheRootPath } from '../../../shared/repo-paths.js';
import { acquireIndexStorageSession } from '../storage-session.js';

const owners = new WeakMap();
const retainedErrors = new WeakSet();
const pendingObserver = error => {
  if (!error) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

/** Admission precedes runtime logger/cache/native initialization. Resolution
 * uses the actual effective config, not a parent inferred from a build path.
 */
export const acquireBuildRuntimeStorage = (root, userConfig) => {
  const owner = acquireIndexStorageSession(resolveRepoCacheRootPath(root, userConfig), { repoRoot: root, userConfig });
  owners.set(owner, { released: false, initializationClosed: false, pending: new Map(), unknownPending: false });
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

const retainedFailure = (error, owner, { cleanupError = null, runtime = null } = {}) => {
  const primary = error && typeof error === 'object' ? error : new Error(String(error), { cause: error });
  const additional = cleanupError && cleanupError !== primary ? cleanupError : null;
  const observers = [primary, additional].filter(Boolean).map(pendingObserver).filter(Boolean);
  const state = owners.get(owner);
  for (const failure of [primary, additional].filter(Boolean)) {
    if (retainedErrors.has(failure) || state.pending.has(failure)) continue;
    const observe = pendingObserver(failure);
    if (!observe) continue;
    if (state.pending.size >= 128) state.unknownPending = true;
    else state.pending.set(failure, observe);
  }
  const cleanupErrors = [...(Array.isArray(primary.cleanupErrors) ? primary.cleanupErrors : []), ...(additional ? [additional] : [])];
  const failure = Object.assign(new AggregateError([primary, ...(additional ? [additional] : [])],
    primary.message || 'Build runtime resource settlement remains unconfirmed.', { cause: primary }), {
    code: primary.code || additional?.code || 'ERR_INDEX_RUNTIME_STORAGE_PENDING', name: primary.name || 'AggregateError',
    cacheOwnershipPending: true,
    cacheOwnershipReleased: () => owners.get(owner)?.released === true && observers.every(observe => observe()),
    ...(cleanupErrors.length ? { cleanupErrors } : {})
  });
  Object.defineProperties(failure, {
    storageSession: { value: owner.session }, buildRuntimeStorage: { value: owner },
    ...(runtime ? { buildRuntime: { value: runtime } } : {})
  });
  retainedErrors.add(failure);
  return failure;
};

/** Only the actual runtime teardown calls this after all of its resource steps
 * finish. A failed step retains the category even when other steps succeeded.
 */
export const retainBuildRuntimeStorageFailure = (runtime, error) => {
  const owner = runtime?.indexRuntimeStorage;
  return owners.has(owner) ? retainedFailure(error, owner, { runtime }) : error;
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
  let cleanupError = null;
  try { await initialization.close(); } catch (failure) { cleanupError = failure; }
  if (!owner) {
    if (!cleanupError) return error;
    const failure = new AggregateError([error, cleanupError], error.message, { cause: error });
    return Object.assign(failure, { code: error.code, name: error.name, cleanupErrors: [cleanupError] });
  }
  const observe = pendingObserver(error);
  if (cleanupError || (observe && !observe())) return retainedFailure(error, owner, { cleanupError });
  // Failure receipt persistence still writes this category after unwind. The
  // outer receipt owner finalizes admission only after that write settles.
  owners.get(owner).initializationClosed = true;
  return error;
};

export const finalizeBuildRuntimeInitializationFailure = ({ error, recordingError = null, owner = null }) => {
  if (!owner) {
    if (!recordingError) return error;
    return Object.assign(new AggregateError([error, recordingError], error.message, { cause: error }), {
      code: error.code, name: error.name, cleanupErrors: [recordingError]
    });
  }
  if (recordingError || owners.get(owner)?.initializationClosed !== true) {
    return retainedFailure(error, owner, { cleanupError: recordingError });
  }
  try { release(owner); } catch (failure) { return retainedFailure(error, owner, { cleanupError: failure }); }
  return error;
};
