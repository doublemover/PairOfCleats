import { releaseFileLockOrThrow } from '../locks/file-lock.js';

const knownMetadataLocks = new WeakSet();
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const observePending = error => {
  if (!error) return null;
  try {
    const observe = error.cacheOwnershipReleased;
    if (error.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

/** Diagnostic context cannot replace a frozen primary or an earlier capability.
 * This helper grants no lifecycle/deletion authority and owns no lock namespace.
 */
export const addStorageFailureContext = (value, fields, secondary = null, { nonEnumerable = [] } = {}) => {
  const primary = asError(value);
  const additional = secondary && secondary !== primary ? asError(secondary) : null;
  const capabilities = new Set(['storageOperationLocks', ...nonEnumerable]);
  const descriptors = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key,
    { value: field, configurable: true, enumerable: !capabilities.has(key) }]));
  const secondaryObserver = observePending(additional);
  const pending = [observePending(primary), secondaryObserver].filter(Boolean);
  if (pending.length) {
    descriptors.cacheOwnershipPending = { value: true, configurable: true };
    descriptors.cacheOwnershipReleased = { value: () => pending.every(observe => observe()), configurable: true };
  }
  try {
    if (additional || Object.keys(fields).some(key => Object.hasOwn(primary, key))) throw new Error('Retain the original context on its exact cause.');
    Object.defineProperties(primary, descriptors);
    return primary;
  } catch {
    const aggregate = new AggregateError([primary, ...(additional ? [additional] : [])], primary.message, { cause: primary });
    const existing = Object.getOwnPropertyDescriptors(primary);
    for (const key of Reflect.ownKeys(existing)) {
      if (['cause', 'errors', 'message', 'stack'].includes(key) || Object.hasOwn(descriptors, key)) continue;
      Object.defineProperty(aggregate, key, existing[key]);
    }
    Object.defineProperties(aggregate, descriptors);
    return aggregate;
  }
};

/** Failed operation-coordinator cleanup exposes only its actual metadata lock.
 * Retrying that handle cannot settle an independent child/native resource.
 */
export const releaseStorageOperationLock = async (lock, operationError = null) => {
  try { return await releaseFileLockOrThrow(lock, { workerError: operationError }); }
  catch (cleanupError) {
    knownMetadataLocks.add(lock);
    let prior = [];
    try { if (Array.isArray(operationError?.storageOperationLocks)) prior = operationError.storageOperationLocks.filter(handle => knownMetadataLocks.has(handle)); } catch {}
    throw addStorageFailureContext(operationError || cleanupError,
      { storageOperationLocks: [...new Set([...prior, lock])] }, operationError ? cleanupError : null);
  }
};
