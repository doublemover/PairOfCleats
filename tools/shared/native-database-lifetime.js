import { createLifecycleRegistry } from '../../src/shared/lifecycle/registry.js';
import { getDelegatedRepoCacheOwner, settleDelegatedRepoCacheOwner } from '../../src/shared/cache/repo-access-delegation.js';
import { assertDelegatedNativeCommandIdentity, assertDelegatedNativeDatabaseScope } from './native-database-authority.js';
import { closeLmdbDatabase } from '../../src/storage/lmdb/close.js';
import { acquireRepoStorageSession } from '../../src/shared/storage/repository-session.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import path from 'node:path';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { readStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { acquireConfiguredNativeStorageSession, configuredNativeStorageConfigurationKey } from '../../src/shared/storage/configured-native-storage.js';

const commands = new Set(['sqlite.compact', 'lmdb.build']);
const pendingOwners = new Set();
export const getPendingNativeDatabaseOwners = () => Object.freeze([...pendingOwners]);
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Internal canonical database entries create no subprocess descendants. Every
 * database (including publication checkpoint handles) joins this existing
 * lifecycle registry before use. A failed close retains unknown ownership.
 */
export const runNativeDatabaseCommand = async ({ commandIdentity, delegated = false }, operation) => {
  if (!commands.has(commandIdentity) || typeof operation !== 'function') throw new TypeError('Unknown native database command.');
  const owner = delegated ? getDelegatedRepoCacheOwner() : null;
  if (owner) assertDelegatedNativeCommandIdentity(owner, commandIdentity);
  let scopeAdmitted = !owner;
  let scopeCheck = null;
  const lifecycle = createLifecycleRegistry({ name: commandIdentity });
  const handles = new WeakMap();
  const states = new Set(), observations = new Map(), described = new WeakSet(), acceptedUses = new Set();
  const storageAdmissions = [];
  let operationSettled = false, registrySettled = false, delegationConfirmed = !owner, observerOverflow = false;
  let acceptedWorkSettled = false, recoveringStorage = null, lastFailure = null;
  const observe = (error, phase = 'native-command-original') => {
    if (objectLike(error) && described.has(error)) return null;
    if (observations.has(error)) return observations.get(error);
    const original = observeStorageResource(error, { phase });
    if (!original.hasResourceObservation) return null;
    if (observations.size >= 128) { observerOverflow = true; return; }
    const retained = original.retain();
    const captured = observeStorageResource(retained, { phase });
    const check = () => captured.isSettled();
    Object.defineProperties(check, { failure: { value: retained }, requireSettled: { value: captured.requireSettled } });
    observations.set(error, check);
    return check;
  };
  const requireOriginals = () => {
    if (observerOverflow) throw new Error('Native command original resource inventory is incomplete.');
    for (const check of observations.values()) {
      try { check.requireSettled(); }
      catch (error) { observe(error); throw error; }
    }
  };
  const requireResult = (value, phase) => {
    const check = observe(value, phase);
    if (observerOverflow) throw new Error('Native command original resource inventory is incomplete.');
    try { check?.requireSettled(); }
    catch (error) { observe(error); throw error; }
    return value;
  };
  const resourcesClosed = () => !observerOverflow && [...states].every(state => state.phase === 'closed')
    && [...observations.values()].every(check => check());
  const isSettled = () => {
    const settled = operationSettled && acceptedWorkSettled && registrySettled && delegationConfirmed && resourcesClosed()
      && storageAdmissions.every(admission => admission.released);
    if (settled) pendingOwners.delete(lifetime);
    return settled;
  };
  const lifetime = Object.freeze({ commandIdentity, resourceId: owner?.resourceId ?? null, isSettled,
    get handles() { return states.size; },
    recoverStorageMetadata: () => {
      if (!recoveringStorage) recoveringStorage = Promise.resolve().then(async () => {
        try {
          releaseStorageMetadata();
          if (owner && !delegationConfirmed) {
            await settleDelegatedRepoCacheOwner({ resourceId: owner.resourceId,
              handlesClosed: true, descendantsSettled: true, pending: false });
            delegationConfirmed = true;
          }
          const settled = isSettled();
          return Object.freeze({ settled, pending: !settled });
        } catch (error) {
          throw preserve(lastFailure, error, { hasPrimary: lastFailure !== null, hasCleanup: true, settlement: true });
        }
      }).finally(() => { recoveringStorage = null; });
      return recoveringStorage;
    } });
  const assertActive = () => {
    if (operationSettled) throw new Error('Native database command no longer admits resource work.');
  };
  const preserve = (primary, cleanup, { hasPrimary = true, hasCleanup = false, settlement = false } = {}) => {
    const errors = [...(hasPrimary ? [primary] : []), ...(hasCleanup && (!hasPrimary || cleanup !== primary) ? [cleanup] : [])];
    for (const [error, check] of observations) if (!check()) {
      for (const original of [error, check.failure, ...(readStorageFailureContext(check.failure)?.inspectionErrors || [])]) {
        if (!errors.includes(original)) errors.push(original);
      }
    }
    let message = 'Native database operation or cleanup failed.';
    const first = errors[0];
    let descriptors = null;
    try { if (typeof first?.message === 'string') message = first.message; }
    catch (error) { errors.push(error); observe(error); }
    if (objectLike(first)) {
      try { descriptors = Object.getOwnPropertyDescriptors(first); }
      catch (error) { errors.push(error); observe(error); }
    }
    const failure = new AggregateError(errors, message, { cause: first });
    if (descriptors) {
      const reserved = new Set(['cause', 'errors', 'message', 'stack', 'nativeCleanupError', 'nativeSettlementError',
        'nativeDatabaseLifetime', 'cacheOwnershipPending', 'cacheOwnershipReleased', 'retryable']);
      for (const key of Reflect.ownKeys(descriptors)) if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    }
    Object.defineProperties(failure, {
      ...(hasCleanup ? { [settlement ? 'nativeSettlementError' : 'nativeCleanupError']: { value: cleanup } } : {}),
      nativeDatabaseLifetime: { value: lifetime }, retryable: { value: false },
      cacheOwnershipPending: { get: () => !isSettled() }, cacheOwnershipReleased: { value: isSettled }
    });
    described.add(failure);
    lastFailure = failure;
    if (!isSettled()) pendingOwners.add(lifetime);
    return failure;
  };
  const resources = Object.freeze({
    admitScope(scope) {
      assertActive();
      scopeAdmitted = false;
      try {
        requireOriginals();
        if (!scope?.repoRoot) throw new TypeError('Native storage scope requires its launch-selected repository context.');
        if (owner) assertDelegatedNativeDatabaseScope(owner, { ...scope, commandId: commandIdentity });
        if (scope?.repoRoot) {
          if (states.size || storageAdmissions.length) throw new Error('Native storage scope must be captured once before handle acquisition.');
          if (!Array.isArray(scope.targets) || !scope.targets.length || scope.targets.length > 16
          || scope.targets.some(target => typeof target !== 'string' || !path.isAbsolute(target))) {
            throw new TypeError('Native storage scope requires bounded absolute selected targets.');
          }
          const admission = acquireRepoStorageSession(scope.repoCacheRoot,
            { repoRoot: scope.repoRoot, userConfig: scope.userConfig, env: scope.env }, {
              scope: 'native-database-command', resourceRoots: scope.targets.filter(target => isPathWithinRoot(target, scope.repoCacheRoot))
            });
          storageAdmissions.push({ session: admission.session, released: false, category: true, revalidate: admission.revalidate });
          admission.revalidate();
          const backend = commandIdentity === 'lmdb.build' ? 'lmdb' : 'sqlite';
          const configurationKey = configuredNativeStorageConfigurationKey(backend, scope.userConfig);
          const configuredContext = { repoRoot: scope.repoRoot, userConfig: scope.userConfig, env: scope.env, nativeBackend: backend };
          for (const target of [...new Set(scope.targets)]) {
            if (isPathWithinRoot(target, scope.repoCacheRoot)) continue;
            const configured = acquireConfiguredNativeStorageSession(target, configuredContext, { scope: `${commandIdentity}-configured-namespace` });
            if (!configured) continue;
            storageAdmissions.push({ session: configured.session, released: false, category: false, revalidate: configured.revalidate });
            configured.revalidate();
          }
          const revalidate = () => {
            if (configuredNativeStorageConfigurationKey(backend, scope.userConfig) !== configurationKey) {
              throw Object.assign(new Error('Native database configured paths changed during admitted work.'), { code: 'ERR_INDEX_STORAGE_SELECTION' });
            }
            for (const original of storageAdmissions) original.revalidate();
          };
          scopeCheck = revalidate;
        }
        scopeAdmitted = true;
      } catch (error) { observe(error); throw error; }
    },
    open(factory) {
      assertActive();
      if (!scopeAdmitted || typeof factory !== 'function') throw new Error('Delegated database paths must be admitted before opening native handles.');
      try { requireOriginals(); scopeCheck?.(); }
      catch (error) { scopeAdmitted = false; observe(error); throw error; }
      return resources.own(factory());
    },
    own(handle) {
      assertActive();
      if (!scopeAdmitted) throw new Error('Delegated database paths must be admitted before opening native handles.');
      if (!objectLike(handle) || handles.has(handle)) throw new TypeError('A new owned native database handle is required.');
      const state = { resource: handle, phase: 'open', promise: null, close: null, closeObservation: null,
        closeStarted: false, work: new Set(), failures: new Set() };
      let originalClose, captureError, captureFailed = false;
      try {
        originalClose = handle.close;
        if (typeof originalClose !== 'function') throw new TypeError('An owned native database close method is required.');
      } catch (error) { captureFailed = true; captureError = error; observe(error); }
      const close = () => {
        if (state.promise) return state.promise;
        state.phase = 'closing';
        state.promise = Promise.resolve().then(async () => {
          await Promise.allSettled([...state.work]);
          for (const failure of state.failures) {
            const observation = observations.get(failure);
            if (observation && !observation()) throw failure;
          }
          if (captureFailed) throw captureError;
          state.closeStarted = true;
          const closed = commandIdentity === 'lmdb.build'
            ? await closeLmdbDatabase(handle, originalClose)
            : await originalClose.call(handle);
          if (closed === false) throw new Error('Native database close was explicitly unconfirmed.');
          state.phase = 'closed';
          state.closeObservation = observe(closed, 'native-command-close-result');
          state.closeObservation?.requireSettled();
          if (observerOverflow) throw new Error('Native command original resource inventory is incomplete.');
        }).catch(error => {
          // Re-admission may dispatch a first close after its original work
          // settles. An invoked native close is never replayed, even on failure.
          if (!state.closeStarted) { state.phase = 'waiting'; state.promise = null; }
          else if (state.phase !== 'closed') state.phase = 'unknown';
          observe(error); throw error;
        });
        state.promise.catch(() => {});
        return state.promise;
      };
      state.close = close;
      lifecycle.register(handle, { close, label: 'native-database' });
      handles.set(handle, { state, close });
      states.add(state);
      if (captureFailed) throw captureError;
      return handle;
    },
    close(handle) {
      const entry = handles.get(handle);
      if (!entry) throw new Error('Cannot settle a database belonging to another native command.');
      return entry.close();
    },
    use(handle, work) {
      try {
        assertActive();
        requireOriginals();
        if (!handles.has(handle) || typeof work !== 'function') throw new TypeError('Owned database work is required.');
        if (handles.get(handle).state.phase !== 'open') throw new Error('Native database handle no longer admits work.');
      } catch (error) { return Promise.reject(error); }
      const state = handles.get(handle).state;
      const working = Promise.resolve().then(() => {
        requireOriginals(); return work(handle);
      }).then(value => requireResult(value, 'native-command-work-result'));
      state.work.add(working);
      working.then(() => state.work.delete(working), error => {
        state.work.delete(working); state.failures.add(error); observe(error);
      });
      const using = (async () => {
        let value, primary, hasPrimary = false;
        try { value = await working; } catch (error) { hasPrimary = true; primary = error; }
        try { await resources.close(handle); }
        catch (error) { throw preserve(primary, error, { hasPrimary, hasCleanup: true }); }
        if (hasPrimary) throw primary;
        return value;
      })();
      acceptedUses.add(using);
      using.catch(() => {});
      return using;
    },
    isClosed: handle => {
      const state = handles.get(handle)?.state;
      try { return state?.phase === 'closed' && (!state.closeObservation || state.closeObservation()); }
      catch { return false; }
    }
  });
  const releaseStorageMetadata = () => {
    if (!operationSettled || !acceptedWorkSettled || !registrySettled || !resourcesClosed()) {
      throw new Error('Original native command resources remain unsettled; metadata-only recovery cannot close or acknowledge them.');
    }
    const errors = [];
    for (const admission of [...storageAdmissions.filter(entry => !entry.category), ...storageAdmissions.filter(entry => entry.category)]) {
      if (admission.released) continue;
      if (admission.category && errors.length) continue;
      try {
        if (admission.session.releaseAfterSettlement({ resourceId: admission.session.resourceId, settled: true, pending: false }) !== true) {
          throw new Error('Native command storage metadata did not confirm original release.');
        }
        admission.released = true;
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Native command storage metadata release failed.', { cause: errors[0] });
  };
  let result, primary, cleanup, hasPrimary = false, hasCleanup = false;
  try { result = await operation(resources); requireResult(result, 'native-command-operation-result'); }
  catch (error) { hasPrimary = true; primary = error; observe(error); }
  finally { operationSettled = true; }
  const uses = await Promise.allSettled([...acceptedUses]);
  acceptedWorkSettled = true;
  const useErrors = [...new Set(uses.filter(result => result.status === 'rejected').map(result => result.reason))];
  const additional = useErrors.filter(error => !hasPrimary || error !== primary);
  if (additional.length) {
    const errors = [...(hasPrimary ? [primary] : []), ...additional];
    primary = errors.length === 1 ? errors[0] : new AggregateError(errors,
      'Native database command and accepted work failed.', { cause: errors[0] });
    hasPrimary = true;
  }
  try { await lifecycle.close(); }
  catch (error) { hasCleanup = true; cleanup = error; observe(error); }
  finally { registrySettled = true; }
  if (hasCleanup || !resourcesClosed()) {
    throw preserve(primary, cleanup, { hasPrimary, hasCleanup });
  }
  try { releaseStorageMetadata(); }
  catch (error) { throw preserve(primary, error, { hasPrimary, hasCleanup: true, settlement: true }); }
  // A failed operation may still prove actual closure. Its failure status is
  // preserved while the parent can release exclusivity after real child close.
  if (owner) {
    try {
      await settleDelegatedRepoCacheOwner({ resourceId: owner.resourceId,
        handlesClosed: true, descendantsSettled: true, pending: false });
      delegationConfirmed = true;
    } catch (error) {
      throw preserve(primary, error, { hasPrimary, hasCleanup: true, settlement: true });
    }
  }
  if (hasPrimary) throw primary;
  return result;
};
