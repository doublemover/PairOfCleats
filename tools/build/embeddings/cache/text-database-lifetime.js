import { retainSessionFailure } from '../../../../src/shared/storage/session.js';
import { observeStorageResource } from '../../../../src/shared/storage/failure-observation.js';

/** Capture the original native closer once. Public method replacement and a
 * failed close cannot turn a retained SQLite connection into settled storage. */
export const createTextDatabaseLifetime = (db, session) => {
  const close = db.close.bind(db);
  let closed = false, released = false, prerequisiteObservation = null;
  const lifetime = { async close(prerequisite = null) {
    if (released) return;
    if (prerequisite && !prerequisiteObservation) prerequisiteObservation = observeStorageResource(prerequisite, { phase: 'embedding-text-cache-resource-settlement' });
    try {
      if (!closed) {
        const result = close();
        if (result?.then || db.open !== false) throw new Error('Text cache database close is unconfirmed.');
        closed = true;
      }
      prerequisiteObservation?.requireSettled();
      session?.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
      released = true;
    } catch (error) {
      const pending = Object.assign(new AggregateError([error], 'Text cache database remains retained.', { cause: error }), {
        code: 'ERR_EMBEDDING_TEXT_DATABASE_CLOSE_PENDING', cacheOwnershipPending: true,
        cacheOwnershipReleased: () => closed && released, textCacheLifetime: lifetime
      });
      throw session ? retainSessionFailure(error, pending, session) : pending;
    }
  } };
  return lifetime;
};
