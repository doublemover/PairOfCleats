import { createLifecycleRegistry } from '../../src/shared/lifecycle/registry.js';
import { getDelegatedRepoCacheOwner, settleDelegatedRepoCacheOwner } from '../../src/shared/cache/repo-access-delegation.js';
import { assertDelegatedNativeCommandIdentity, assertDelegatedNativeDatabaseScope } from './native-database-authority.js';

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
  const lifecycle = createLifecycleRegistry({ name: commandIdentity });
  const handles = new WeakMap();
  const states = new Set(), observations = new Map(), described = new WeakSet(), acceptedUses = new Set();
  let operationSettled = false, registrySettled = false, delegationConfirmed = !owner, observerOverflow = false;
  const observe = error => {
    if (!objectLike(error) || described.has(error) || observations.has(error)) return;
    let observation = null;
    try {
      const method = error.cacheOwnershipReleased;
      if (error.cacheOwnershipPending === true || typeof method === 'function') {
        observation = () => { try { return typeof method === 'function' && method.call(error) === true; } catch { return false; } };
      }
    } catch { observation = () => false; }
    if (observation) {
      if (observations.size < 128) observations.set(error, observation); else observerOverflow = true;
    }
  };
  const resourcesClosed = () => !observerOverflow && [...states].every(state => state.phase === 'closed')
    && [...observations.values()].every(check => check());
  const isSettled = () => {
    const settled = operationSettled && registrySettled && delegationConfirmed && resourcesClosed();
    if (settled) pendingOwners.delete(lifetime);
    return settled;
  };
  const lifetime = Object.freeze({ commandIdentity, resourceId: owner?.resourceId ?? null, isSettled,
    get handles() { return states.size; } });
  const assertActive = () => {
    if (operationSettled) throw new Error('Native database command no longer admits resource work.');
  };
  const preserve = (primary, cleanup, { hasPrimary = true, hasCleanup = false, settlement = false } = {}) => {
    const errors = [...(hasPrimary ? [primary] : []), ...(hasCleanup && (!hasPrimary || cleanup !== primary) ? [cleanup] : [])];
    for (const [error, check] of observations) if (!check() && !errors.includes(error)) errors.push(error);
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
    if (!isSettled()) pendingOwners.add(lifetime);
    return failure;
  };
  const resources = Object.freeze({
    admitScope(scope) {
      assertActive();
      if (owner) assertDelegatedNativeDatabaseScope(owner, { ...scope, commandId: commandIdentity });
      scopeAdmitted = true;
    },
    open(factory) {
      assertActive();
      if (!scopeAdmitted || typeof factory !== 'function') throw new Error('Delegated database paths must be admitted before opening native handles.');
      return resources.own(factory());
    },
    own(handle) {
      assertActive();
      if (!scopeAdmitted) throw new Error('Delegated database paths must be admitted before opening native handles.');
      if (!objectLike(handle) || handles.has(handle)) throw new TypeError('A new owned native database handle is required.');
      const state = { resource: handle, phase: 'open', promise: null, close: null, work: new Set(), failures: new Set() };
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
          if (await originalClose.call(handle) === false) throw new Error('Native database close was explicitly unconfirmed.');
          state.phase = 'closed';
        }).catch(error => { state.phase = 'unknown'; observe(error); throw error; });
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
        if (!handles.has(handle) || typeof work !== 'function') throw new TypeError('Owned database work is required.');
        if (handles.get(handle).state.phase !== 'open') throw new Error('Native database handle no longer admits work.');
      } catch (error) { return Promise.reject(error); }
      const state = handles.get(handle).state;
      const working = Promise.resolve().then(() => work(handle));
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
    isClosed: handle => handles.get(handle)?.state.phase === 'closed'
  });
  let result, primary, cleanup, hasPrimary = false, hasCleanup = false;
  try { result = await operation(resources); }
  catch (error) { hasPrimary = true; primary = error; observe(error); }
  finally { operationSettled = true; }
  const uses = await Promise.allSettled([...acceptedUses]);
  const useErrors = [...new Set(uses.filter(result => result.status === 'rejected').map(result => result.reason))];
  const additional = useErrors.filter(error => !hasPrimary || error !== primary);
  if (additional.length) {
    const errors = [...(hasPrimary ? [primary] : []), ...additional];
    primary = errors.length === 1 ? errors[0] : new AggregateError(errors,
      'Native database command and accepted work failed.', { cause: errors[0] });
    hasPrimary = true;
  }
  try { await lifecycle.close(); registrySettled = true; }
  catch (error) { hasCleanup = true; cleanup = error; observe(error); }
  if (hasCleanup || !resourcesClosed()) {
    throw preserve(primary, cleanup, { hasPrimary, hasCleanup });
  }
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
