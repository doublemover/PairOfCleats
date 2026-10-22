import { createLifecycleRegistry } from '../../src/shared/lifecycle/registry.js';
import { getDelegatedRepoCacheOwner, settleDelegatedRepoCacheOwner } from '../../src/shared/cache/repo-access-delegation.js';
import { assertDelegatedNativeCommandIdentity, assertDelegatedNativeDatabaseScope } from './native-database-authority.js';

const commands = new Set(['sqlite.compact', 'lmdb.build']);

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
  const resources = Object.freeze({
    admitScope(scope) {
      if (owner) assertDelegatedNativeDatabaseScope(owner, { ...scope, commandId: commandIdentity });
      scopeAdmitted = true;
    },
    open(factory) {
      if (!scopeAdmitted || typeof factory !== 'function') throw new Error('Delegated database paths must be admitted before opening native handles.');
      return resources.own(factory());
    },
    own(handle) {
      if (!scopeAdmitted) throw new Error('Delegated database paths must be admitted before opening native handles.');
      if (!handle || typeof handle.close !== 'function' || handles.has(handle)) throw new TypeError('A new owned native database handle is required.');
      const state = { phase: 'open', promise: null };
      const close = () => {
        if (state.promise) return state.promise;
        state.phase = 'closing';
        state.promise = Promise.resolve().then(() => handle.close()).then(() => {
          state.phase = 'closed';
        }, error => { state.phase = 'unknown'; throw error; });
        return state.promise;
      };
      lifecycle.register(handle, { close, label: 'native-database' });
      handles.set(handle, { state, close });
      return handle;
    },
    close(handle) {
      const entry = handles.get(handle);
      if (!entry) throw new Error('Cannot settle a database belonging to another native command.');
      return entry.close();
    },
    async use(handle, work) {
      if (!handles.has(handle) || typeof work !== 'function') throw new TypeError('Owned database work is required.');
      let value, primary = null;
      try { value = await work(handle); } catch (error) { primary = error; }
      try { await resources.close(handle); }
      catch (error) {
        if (primary) { primary.nativeCleanupError = error; throw primary; }
        throw error;
      }
      if (primary) throw primary;
      return value;
    },
    isClosed: handle => handles.get(handle)?.state.phase === 'closed'
  });
  let result, primary = null, cleanup = null;
  try { result = await operation(resources); }
  catch (error) { primary = error; }
  try { await lifecycle.close(); }
  catch (error) { cleanup = error; }
  if (cleanup) {
    const error = primary || cleanup;
    if (primary && primary !== cleanup) error.nativeCleanupError = cleanup;
    if (owner) error.cacheOwnershipPending = true;
    throw error;
  }
  // A failed operation may still prove actual closure. Its failure status is
  // preserved while the parent can release exclusivity after real child close.
  if (owner) {
    try {
      await settleDelegatedRepoCacheOwner({ resourceId: owner.resourceId,
        handlesClosed: true, descendantsSettled: true, pending: false });
    } catch (error) {
      if (primary) { primary.nativeSettlementError = error; primary.cacheOwnershipPending = true; throw primary; }
      error.cacheOwnershipPending = true;
      throw error;
    }
  }
  if (primary) throw primary;
  return result;
};
