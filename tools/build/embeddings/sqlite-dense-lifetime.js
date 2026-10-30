import { createSqliteCacheCloseOwner, getSqliteCacheFailureOwner } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

const lifetimes = new WeakMap();
const failure = message => Object.assign(new Error(message), { code: 'ERR_SQLITE_DENSE_CLEANUP' });
export const getSqliteDenseLifetime = error => error !== null && ['object', 'function'].includes(typeof error) ? lifetimes.get(error) || null : null;
export const retainSqliteDenseCleanupFailure = (primary, cleanup) => {
  const error = addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true, forceAggregate: true });
  const owner = getSqliteDenseLifetime(cleanup);
  if (owner) lifetimes.set(error, owner);
  return error;
};

/** Compose the existing original SQLite-close and contained-source owners while
 * preserving this component's synchronous API. Recovery closes only resources;
 * it cannot re-enter vector reconciliation, rollback or native initialization.
 */
export const createSqliteDenseLifetime = source => {
  const work = [], closing = [], closeSessions = new Set();
  let dbOwner = null, databaseAttached = false, sourceClose, sourceStarted = false, sourceClosed = false, sourceFailure, hasSourceFailure = false;
  let lastFailure = null, overflow = false;
  let asyncCloseFailure, hasAsyncCloseFailure = false;
  const capture = (value, list, phase) => {
    const observation = observeStorageResource(value, { phase });
    if (list.length >= 128) overflow = true;
    else list.push(observation);
    const session = getContainedFileSession(value);
    if (session?.releaseAfterCloseSync) closeSessions.add(session);
    return observation;
  };
  const requireWork = () => {
    if (overflow) throw Object.assign(failure('SQLite dense observation history is incomplete.'), { cacheOwnershipPending: true });
    for (const observation of work) observation.requireSettled();
  };
  const isSettled = () => {
    try {
      return !overflow && sourceClosed && (!databaseAttached || dbOwner?.isSettled() === true)
        && work.every(observation => observation.isSettled()) && closing.every(observation => observation.isSettled());
    } catch { return false; }
  };
  const combine = errors => {
    if (hasAsyncCloseFailure && !errors.includes(asyncCloseFailure)) errors.push(asyncCloseFailure);
    let error = errors.length ? errors[0] : failure('SQLite dense resources remain unconfirmed.');
    for (const secondary of errors.slice(1)) error = addStorageFailureContext(error, {}, secondary, { secondaryPresent: true, forceAggregate: true });
    error = addStorageFailureContext(error, { sqliteDenseLifetime: lifetime, cacheOwnershipPending: true,
      cacheOwnershipReleased: isSettled }, null, { nonEnumerable: ['sqliteDenseLifetime'] });
    lifetimes.set(error, lifetime); lastFailure = error; return error;
  };
  const close = ({ explicit = false } = {}) => {
    const errors = [];
    if (explicit) {
      // Only exact existing descriptor sessions can reconcile a close failure
      // raised by the source iterator itself. They gate their own active reads.
      for (const session of closeSessions) {
        try { session.releaseAfterCloseSync(); }
        catch (error) { capture(error, closing, 'sqlite-dense-source-recovery'); errors.push(error); }
      }
    }
    try { requireWork(); }
    catch (error) { throw combine([...errors, error]); }
    if (dbOwner) {
      try {
        const result = explicit ? dbOwner.release() : dbOwner.retire();
        if (result?.settled !== true || !dbOwner.isSettled()) throw dbOwner.lastError || failure('Original SQLite close is not settled.');
      } catch (error) { capture(error, closing, 'sqlite-dense-original-db-close'); errors.push(error); }
    } else if (databaseAttached) errors.push(failure('SQLite dense database has no captured original close owner.'));
    if (!sourceStarted) {
      sourceStarted = true;
      try {
        if (typeof sourceClose !== 'function') throw failure('Original dense source close is unavailable.');
        const result = sourceClose.call(source);
        if (result instanceof Promise) Promise.prototype.then.call(result, () => {}, error => {
          hasAsyncCloseFailure = true; asyncCloseFailure = error;
          try { capture(error, closing, 'sqlite-dense-async-close-rejection'); } catch { overflow = true; }
        });
        capture(result, closing, 'sqlite-dense-original-source-close').requireSettled();
        if (result !== undefined) throw failure('Dense source returned unknown synchronous close evidence.');
        sourceClosed = true;
      } catch (error) {
        hasSourceFailure = true; sourceFailure = error;
        capture(error, closing, 'sqlite-dense-original-source-close-error'); errors.push(error);
      }
    } else if (!sourceClosed && closeSessions.size && [...closeSessions].every(session => session.isSettled())) {
      sourceClosed = true;
    } else if (!sourceClosed && hasSourceFailure) errors.push(sourceFailure);
    if (errors.length || !isSettled()) throw combine(errors);
    return Object.freeze({ settled: true, pending: false });
  };
  const lifetime = Object.freeze({ isSettled, recoverResources: () => close({ explicit: true }),
    rememberWork(value) { capture(value, work, 'sqlite-dense-original-work'); },
    requireWork,
    attachDatabase(db) {
      databaseAttached = true;
      try { dbOwner = createSqliteCacheCloseOwner(db, { canClose: () => {
        try { requireWork(); return true; } catch { return false; }
      }, onClosed() {} }); }
      catch (error) { dbOwner = getSqliteCacheFailureOwner(error); capture(error, work, 'sqlite-dense-close-capture'); throw error; }
    },
    close: () => close(),
    retain(error) { return combine([error]); },
    get lastFailure() { return lastFailure; }
  });
  try {
    sourceClose = source.close;
    if (typeof sourceClose !== 'function') throw failure('Dense source has no original close owner.');
  } catch (error) { capture(error, work, 'sqlite-dense-source-close-capture'); throw combine([error]); }
  return lifetime;
};
