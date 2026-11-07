import { isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';
import { createManagedVerificationObservation } from './managed-verification-observation.js';

const verificationFailures = new WeakMap();
const settledVerificationFailures = new WeakMap();
const storageVerificationFailures = new WeakMap();
const verificationResults = new WeakMap();
const objectLike = value => value !== null && ['object', 'function'].includes(typeof value);
// Only the actual operational storage owner registers these in-process
// capabilities. Serialized/lookalike error fields cannot authorize release.
export const trackManagedVerificationStorageFailure = (error, recovery) => { storageVerificationFailures.set(error, recovery); return error; };
export const getManagedVerificationStorageRecovery = error => objectLike(error) ? storageVerificationFailures.get(error) || null : null;
const asError = value => objectLike(value) ? value : new Error(String(value), { cause: value });
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
    if (additional || Object.hasOwn(primary, 'managedInstallSession') || Object.hasOwn(primary, 'managedRemovalSession')
      || Object.hasOwn(primary, 'goSdkInstallSession') || Object.hasOwn(primary, 'downloadSession')) throw new Error('Keep original verification context.');
    Object.defineProperties(primary, descriptors);
    return primary;
  } catch {
    let message = 'Managed resource verification or settlement failed.';
    try { const descriptor = Object.getOwnPropertyDescriptor(primary, 'message');
      if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') message = descriptor.value; } catch {}
    const failure = new AggregateError([primary, ...(additional ? [additional] : [])], message, { cause: primary });
    const existing = Object.getOwnPropertyDescriptors(primary);
    for (const key of Reflect.ownKeys(existing)) {
      if (['cause', 'errors', 'message', 'stack'].includes(key) || Object.hasOwn(descriptors, key)) continue;
      Object.defineProperty(failure, key, existing[key]);
    }
    Object.defineProperties(failure, descriptors);
    return failure;
  }
};

export const captureManagedVerificationFailure = (error, resourceId) => {
  const owned = verificationFailures.get(error);
  const result = verificationResults.get(error);
  return { owned: owned?.resourceId === resourceId,
    observe: owned?.resourceId === resourceId ? owned.observe : result?.resourceId === resourceId ? result.observation.isSettled : observePending(error) };
};

export const retainManagedResourceFailure = (value, { session, released, cleanupError = null, field = 'managedInstallSession',
  cleanupField = 'managedCleanupError' }) => {
  const primary = asError(value);
  return withPendingContext(primary, {
    cacheOwnershipPending: { value: true, configurable: true },
    cacheOwnershipReleased: { value: released, configurable: true },
    [field]: { value: session, configurable: true },
    ...(cleanupError && cleanupError !== primary ? { [cleanupField]: { value: cleanupError, configurable: true } } : {})
  }, cleanupError);
};

/** Missing recipe settlement is owned by this invocation, while pre-existing
 * native/child observers retain their independent authority and exact receiver.
 */
export const verifyOwnedResource = async (verify, input, resourceId) => {
  if (typeof resourceId !== 'string' || !resourceId || resourceId.length > 256) throw new TypeError('Managed verification requires its exact bounded invocation resource identity.');
  input.signal?.throwIfAborted();
  let result, primary = null, failed = false;
  try { result = await verify({ ...input, resourceId }); }
  catch (value) { failed = true; primary = asError(value); }
  const observation = createManagedVerificationObservation();
  const original = failed ? primary : result; observation.remember(original);
  let settled = false, inspectionError = null;
  try { settled = observation.settlement(original, resourceId); }
  catch (error) { inspectionError = asError(error); observation.remember(inspectionError); }
  const observe = observation.hasObservedResources() ? observation.isSettled : null;
  if (failed) {
    if (settled && !inspectionError && observation.isSettled()) { settledVerificationFailures.set(primary, resourceId); throw primary; }
    const failure = withPendingContext(primary, { cacheOwnershipPending: { value: true, configurable: true },
      ...(observe ? { cacheOwnershipReleased: { value: observe, configurable: true } } : {}) }, inspectionError);
    verificationFailures.set(failure, { resourceId, observe });
    throw failure;
  }
  if (!result || typeof result !== 'object' || Array.isArray(result) || !settled || inspectionError || !observation.isSettled()) {
    const pending = Object.assign(new Error('Managed recipe verification did not confirm exact child/resource settlement.', { cause: result }), {
      code: 'ERR_MANAGED_VERIFY_PENDING', cacheOwnershipPending: true
    });
    const failure = inspectionError ? withPendingContext(pending, {}, inspectionError) : pending;
    if (observe) Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => observe(), configurable: true });
    verificationFailures.set(failure, { resourceId, observe });
    throw failure;
  }
  verificationResults.set(result, { resourceId, observation });
  return result;
};

export const verifyOwnedInstallation = async (verify, input, resourceId) => {
  const result = await verifyOwnedResource(verify, input, resourceId);
  const { observation } = verificationResults.get(result);
  let ok;
  try { ok = observation.read(result, 'ok') === true; }
  catch (value) {
    const primary = asError(value); observation.remember(primary);
    const pending = !observation.isSettled();
    const failure = withPendingContext(primary, { verificationResult: { value: result, configurable: true },
      settlement: { value: { resourceId, settled: true, pending: false }, configurable: true },
      ...(pending ? { cacheOwnershipPending: { value: true, configurable: true },
        cacheOwnershipReleased: { value: observation.isSettled, configurable: true } } : {}) }, result);
    if (pending) verificationFailures.set(failure, { resourceId, observe: observation.isSettled });
    else settledVerificationFailures.set(failure, resourceId);
    throw failure;
  }
  if (!ok) {
    const failure = Object.assign(new Error('Pinned tool executable/runtime/capability verification failed.', { cause: result }), {
      verificationResult: result, settlement: { resourceId, settled: true, pending: false }
    });
    settledVerificationFailures.set(failure, resourceId);
    throw failure;
  }
  return result;
};

/** Actual selected-generation verification keeps its original retained handle
 * through recipe settlement and exact metadata-release retry. No downloads or
 * publication belong to this existing-generation consumer.
 */
export const verifyRetainedManagedInstallation = async (held, verify, input, resourceId) => {
  let released = false, resourceSettled = false, firstFailure = null, observerOverflow = false;
  const storageRecoveries = new Set();
  const observers = [], observed = new WeakSet(), described = new WeakSet(), ownedMetadataFailures = new WeakSet();
  const observeFailure = error => {
    if (!objectLike(error) || observed.has(error) || described.has(error) || ownedMetadataFailures.has(error)) return;
    observed.add(error);
    const storage = getManagedVerificationStorageRecovery(error);
    if (storage) storageRecoveries.add(storage);
    const { observe } = captureManagedVerificationFailure(error, resourceId);
    if (observe) {
      if (observers.length < 128) observers.push(observe);
      else observerOverflow = true;
    }
  };
  const settled = () => !observerOverflow && resourceSettled && [...storageRecoveries].every(storage => storage.isReleased()) && observers.every(observe => observe());
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
      for (const storage of storageRecoveries) storage.releaseAfterClosure();
      return release(receipt);
    }
    catch (error) { observeFailure(error); throw retainFailure(firstFailure || error, error); }
  } });
  const retainFailure = (value, secondary = null) => {
    const primary = asError(value);
    firstFailure ||= primary;
    const additional = secondary && secondary !== primary ? secondary : null;
    const failure = retainManagedResourceFailure(primary, { session, released: () => released && settled(), cleanupError: additional });
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
  } catch (value) {
    const error = asError(value);
    observeFailure(error);
    if (settledVerificationFailures.get(error) === resourceId) resourceSettled = true;
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
