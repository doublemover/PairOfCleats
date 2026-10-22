import { isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';

const verificationFailures = new WeakMap();
const settledVerificationFailures = new WeakMap();
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
    if (additional || Object.hasOwn(primary, 'managedInstallSession') || Object.hasOwn(primary, 'managedRemovalSession')
      || Object.hasOwn(primary, 'goSdkInstallSession') || Object.hasOwn(primary, 'downloadSession')) throw new Error('Keep original verification context.');
    Object.defineProperties(primary, descriptors);
    return primary;
  } catch {
    let message = 'Managed resource verification or settlement failed.';
    try { if (typeof primary.message === 'string') message = primary.message; } catch {}
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
  return { owned: owned?.resourceId === resourceId,
    observe: owned?.resourceId === resourceId ? owned.observe : observePending(error) };
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
  input.signal?.throwIfAborted();
  let result;
  try { result = await verify({ ...input, resourceId }); }
  catch (value) {
    const primary = asError(value);
    let settled = false, receiptError = null;
    try { settled = exactSettlement(primary.settlement, resourceId); } catch (error) { receiptError = asError(error); }
    const observations = [observePending(primary), observePending(receiptError)].filter(Boolean);
    const observe = observations.length ? () => observations.every(check => check()) : null;
    if (settled && (!observe || observe())) { settledVerificationFailures.set(primary, resourceId); throw primary; }
    const failure = withPendingContext(primary, { cacheOwnershipPending: { value: true, configurable: true },
      ...(observe ? { cacheOwnershipReleased: { value: () => observe(), configurable: true } } : {}) }, receiptError);
    verificationFailures.set(failure, { resourceId, observe });
    throw failure;
  }
  let settled = false, inspectionError = null;
  try { settled = exactSettlement(result?.settlement, resourceId); } catch (value) { inspectionError = asError(value); }
  const observations = [observePending(result), observePending(inspectionError)].filter(Boolean);
  const observe = observations.length ? () => observations.every(check => check()) : null;
  if (!settled || inspectionError || observe && !observe()) {
    const pending = Object.assign(new Error('Managed recipe verification did not confirm exact child/resource settlement.', { cause: result }), {
      code: 'ERR_MANAGED_VERIFY_PENDING', cacheOwnershipPending: true
    });
    const failure = inspectionError ? withPendingContext(pending, {}, inspectionError) : pending;
    if (observe) Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => observe(), configurable: true });
    verificationFailures.set(failure, { resourceId, observe });
    throw failure;
  }
  return result;
};

export const verifyOwnedInstallation = async (verify, input, resourceId) => {
  const result = await verifyOwnedResource(verify, input, resourceId);
  let ok;
  try { ok = result.ok === true; }
  catch (value) {
    const primary = asError(value), original = observePending(primary);
    const pending = Boolean(original && !original());
    const failure = withPendingContext(primary, { verificationResult: { value: result, configurable: true },
      settlement: { value: { resourceId, settled: true, pending: false }, configurable: true },
      ...(pending ? { cacheOwnershipPending: { value: true, configurable: true },
        cacheOwnershipReleased: { value: () => original(), configurable: true } } : {}) });
    if (pending) verificationFailures.set(failure, { resourceId, observe: original });
    else settledVerificationFailures.set(failure, resourceId);
    throw failure;
  }
  if (!ok) {
    const failure = Object.assign(new Error('Pinned tool executable/runtime/capability verification failed.'), {
      settlement: { resourceId, settled: true, pending: false }
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
