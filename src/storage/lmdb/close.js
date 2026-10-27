import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

/** LMDB 3.5.1 can resolve close() before an outstanding prefetch drains. Its
 * completion callback runs after that work and the native environment close.
 * The caller owns idempotence and captures the method before using the store.
 */
export const closeLmdbDatabase = async (db, originalClose) => {
  let completed = false;
  let callbackClosed;
  const closed = new Promise(resolve => { callbackClosed = resolve; });
  try {
    if (typeof originalClose !== 'function') throw new TypeError('LMDB requires its captured close method.');
    const result = await originalClose.call(db, callbackClosed);
    if (result === false) throw new Error('LMDB close explicitly remained unconfirmed.');
    await closed;
    completed = true;
  } catch (error) {
    // Failure never grants closure authority, including an early Promise result
    // or a later callback after the original close reported failure.
    throw addStorageFailureContext(error, { cacheOwnershipPending: true,
      cacheOwnershipReleased: () => completed });
  }
};
