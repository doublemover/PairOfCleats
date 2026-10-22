import { isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';

const verificationFailures = new WeakMap();
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const observePending = error => {
  if (!error) return null;
  try {
    const original = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof original !== 'function') return null;
    return () => { try { return typeof original === 'function' && original.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};
const exactSettlement = (receipt, resourceId) => receipt && typeof receipt === 'object' && !Array.isArray(receipt)
  && Object.keys(receipt).sort().join(',') === 'pending,resourceId,settled' && receipt.resourceId === resourceId
  && receipt.settled === true && receipt.pending === false;
const withPendingContext = (primary, descriptors, secondary = null) => {
  const additional = secondary && secondary !== primary ? secondary : null;
  try {
    if (additional || Object.hasOwn(primary, 'managedInstallSession')) throw new Error('Keep original verification context.');
    Object.defineProperties(primary, descriptors);
    return primary;
  } catch {
    const failure = new AggregateError([primary, ...(additional ? [additional] : [])], primary.message, { cause: primary });
    const existing = Object.getOwnPropertyDescriptors(primary);
    for (const key of Reflect.ownKeys(existing)) {
      if (['cause', 'errors', 'message', 'stack'].includes(key) || Object.hasOwn(descriptors, key)) continue;
      Object.defineProperty(failure, key, existing[key]);
    }
    Object.defineProperties(failure, descriptors);
    return failure;
  }
};

/** Missing recipe settlement is owned by this invocation, while pre-existing
 * native/child observers retain their independent authority and exact receiver.
 */
export const verifyOwnedInstallation = async (verify, input, resourceId) => {
  input.signal?.throwIfAborted();
  let result;
  try { result = await verify({ ...input, resourceId }); }
  catch (value) {
    const primary = asError(value), observe = observePending(primary);
    if (exactSettlement(primary.settlement, resourceId) && (!observe || observe())) throw primary;
    const failure = withPendingContext(primary, { cacheOwnershipPending: { value: true, configurable: true },
      ...(observe ? { cacheOwnershipReleased: { value: () => observe(), configurable: true } } : {}) });
    verificationFailures.set(failure, { resourceId, observe });
    throw failure;
  }
  const observe = observePending(result);
  if (!exactSettlement(result?.settlement, resourceId) || observe && !observe()) {
    const failure = Object.assign(new Error('Managed recipe verification did not confirm exact child/resource settlement.', { cause: result }), {
      code: 'ERR_MANAGED_VERIFY_PENDING', cacheOwnershipPending: true
    });
    if (observe) Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => observe(), configurable: true });
    verificationFailures.set(failure, { resourceId, observe });
    throw failure;
  }
  if (result.ok !== true) throw Object.assign(new Error('Pinned tool executable/runtime/capability verification failed.'), {
    settlement: { resourceId, settled: true, pending: false }
  });
  return result;
};

/** Actual selected-generation verification keeps its original retained handle
 * through recipe settlement and exact metadata-release retry. No downloads or
 * publication belong to this existing-generation consumer.
 */
export const verifyRetainedManagedInstallation = async (held, verify, input, resourceId) => {
  let released = false, resourceSettled = false, firstFailure = null, observerOverflow = false;
  const observers = [], observed = new WeakSet(), described = new WeakSet(), ownedMetadataFailures = new WeakSet();
  const observeFailure = error => {
    if (!error || typeof error !== 'object' || observed.has(error) || described.has(error) || ownedMetadataFailures.has(error)) return;
    observed.add(error);
    const owned = verificationFailures.get(error);
    const observe = owned?.resourceId === resourceId ? owned.observe : observePending(error);
    if (observe) {
      if (observers.length < 128) observers.push(observe);
      else observerOverflow = true;
    }
  };
  const settled = () => !observerOverflow && resourceSettled && observers.every(observe => observe());
  const release = receipt => {
    if (receipt !== undefined) {
      if (!exactSettlement(receipt, resourceId)) throw new Error('Managed verification remains pending.');
      resourceSettled = true;
    }
    if (!settled()) throw new Error('Managed verification remains pending.');
    if (released) return true;
    let confirmed;
    try { confirmed = held.release(); }
    catch (error) {
      if (isStorageSessionReleaseFailure(error, held.storageSession)) ownedMetadataFailures.add(error);
      throw error;
    }
    if (confirmed !== true) throw Object.assign(new Error('Managed tool verification lease could not be released.'), { code: 'ERR_MANAGED_VERIFY_RELEASE' });
    released = true;
    return true;
  };
  const session = Object.freeze({ resourceId, releaseAfterSettlement: receipt => {
    try {
      if (!exactSettlement(receipt, resourceId)) throw new Error('Managed verification remains pending.');
      return release(receipt);
    }
    catch (error) { observeFailure(error); throw retainFailure(firstFailure || error, error); }
  } });
  const retainFailure = (value, secondary = null) => {
    const primary = asError(value);
    firstFailure ||= primary;
    const additional = secondary && secondary !== primary ? secondary : null;
    const failure = withPendingContext(primary, {
      cacheOwnershipPending: { value: true, configurable: true },
      cacheOwnershipReleased: { value: () => released && settled(), configurable: true },
      managedInstallSession: { value: session, configurable: true },
      ...(additional ? { managedCleanupError: { value: additional, configurable: true } } : {})
    }, additional);
    described.add(failure);
    return failure;
  };
  let primaryError = null;
  try {
    if (input.signal?.aborted) { resourceSettled = true; input.signal.throwIfAborted(); }
    const verification = await verifyOwnedInstallation(verify, input, resourceId);
    observeFailure(verification);
    resourceSettled = true;
    input.signal?.throwIfAborted();
    return verification;
  } catch (error) {
    observeFailure(error);
    if (!verificationFailures.has(error) && exactSettlement(error.settlement, resourceId)) resourceSettled = true;
    primaryError = error;
    if (!settled()) throw retainFailure(error);
    throw error;
  } finally {
    if (settled()) {
      try { release(); }
      catch (error) { observeFailure(error); throw retainFailure(primaryError || error, primaryError ? error : null); }
    }
  }
};
