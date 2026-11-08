import { addStorageFailureContext } from './operation-error.js';

const knownMetadataLocks = new WeakSet();
const asError = value => value !== null && (typeof value === 'object' || typeof value === 'function')
  ? value : new Error(String(value), { cause: value });

/** Failed operation-coordinator cleanup exposes only its actual metadata lock.
 * Retrying that handle cannot settle an independent child/native resource.
 */
export const releaseStorageOperationLock = async (lock, operationError = null) => {
  try {
    const { releaseFileLockOrThrow } = await import('../locks/file-lock.js');
    return await releaseFileLockOrThrow(lock, { workerError: operationError });
  }
  catch (cleanupError) {
    knownMetadataLocks.add(lock);
    const operationPresent = operationError !== null && operationError !== undefined;
    let primary = operationPresent ? operationError : cleanupError;
    let prior = [];
    try {
      const existing = operationError?.storageOperationLocks;
      if (Array.isArray(existing)) prior = existing.filter(handle => knownMetadataLocks.has(handle));
    } catch (inspectionError) {
      primary = addStorageFailureContext(primary, { storageOperationContextError: inspectionError }, inspectionError,
        { secondaryPresent: true });
    }
    throw addStorageFailureContext(primary, { storageOperationLocks: [...new Set([...prior, lock])] },
      operationPresent ? cleanupError : null);
  }
};

