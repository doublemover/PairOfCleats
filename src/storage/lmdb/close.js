import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

/** LMDB 3.5.1 can resolve close() before an outstanding prefetch drains. Its
 * completion callback runs after that work and the native environment close.
 * The caller owns idempotence and captures the method before using the store.
 */
export const createLmdbCloseOwner = (db, originalClose) => {
  let returned = false, callbackCompleted = false, nativeFailed = false, closing = null;
  const observations = new Map();
  let callbackClosed;
  const closed = new Promise(resolve => { callbackClosed = () => { callbackCompleted = true; resolve(); }; });
  const capture = value => {
    if (observations.has(value)) return observations.get(value);
    const original = observeStorageResource(value, { phase: 'lmdb-original-close' });
    if (!original.hasResourceObservation) return null;
    const captured = observeStorageResource(original.retain(), { phase: 'lmdb-original-close' });
    observations.set(value, captured); return captured;
  };
  const isPhysicallyClosed = () => returned && callbackCompleted && !nativeFailed;
  const isSettled = () => {
    try { return isPhysicallyClosed() && [...observations.values()].every(observation => observation.isSettled()); }
    catch { return false; }
  };
  const owner = Object.freeze({ isSettled, isPhysicallyClosed,
    cacheOwnershipPending: true, cacheOwnershipReleased: isSettled,
    close() {
      if (!closing) {
        closing = Promise.resolve().then(async () => {
          let result;
          try {
            if (typeof originalClose !== 'function') throw new TypeError('LMDB requires its captured close method.');
            result = await originalClose.call(db, callbackClosed);
            if (result === false) throw new Error('LMDB close explicitly remained unconfirmed.');
            returned = true;
          } catch (error) { nativeFailed = true; throw error; }
          // Capture before waiting for the native callback: a replaceable
          // result getter cannot change the original prerequisite meanwhile.
          const observation = capture(result);
          await closed;
          observation?.requireSettled();
        }).catch(error => {
          capture(error);
          // A failed original native call stays unknown even if its callback
          // arrives later. A successful physical close may separately await
          // an original result/inspection owner, without repeating close.
          throw addStorageFailureContext(error, { cacheOwnershipPending: true,
            cacheOwnershipReleased: isSettled, lmdbCloseOwner: owner }, null,
          { forceAggregate: true, nonEnumerable: ['lmdbCloseOwner'] });
        });
        closing.catch(() => {});
      }
      return closing;
    }
  });
  return owner;
};

// Compatibility entry for callers that already own their close idempotence.
export const closeLmdbDatabase = (db, originalClose) => createLmdbCloseOwner(db, originalClose).close();
