const pending = new Set(), failureOwners = new WeakMap();
const cacheHandoffs = new WeakMap();
const nativeSettlements = new WeakMap();
export const getSqliteNativeSettlement = db => {
  const captured = nativeSettlements.get(db);
  if (captured?.owner.lastError && !captured.owner.isSettled()) throw captured.owner.lastError;
  return captured?.settled || null;
};
export const addSqliteNativeSettlementHook = (db, hook) => {
  const physical = nativeSettlements.get(db);
  if (!physical || typeof hook !== 'function' || physical.retired()) throw new Error('SQLite storage requires its active original native owner.');
  physical.hooks.add(hook);
};
/** Only an original constructor-time owner can transfer its reference gate to
 * the built-in cache. A handle field or replacement close method grants nothing.
 */
export const takeSqliteCacheCloseOwner = (db, gate) => {
  const handoff = cacheHandoffs.get(db);
  if (!handoff) return null;
  const owner = handoff(gate);
  cacheHandoffs.delete(db);
  return owner;
};
const objectLike = value => value !== null && ['object', 'function'].includes(typeof value);
export const getPendingSqliteCacheOwners = () => Object.freeze([...pending]);
export const getSqliteCacheFailureOwner = error => objectLike(error) ? failureOwners.get(error) || null : null;

/** Own one cached or uncached handle's captured synchronous close. A failed invocation is not
 * repeated by eviction/dispose; explicit reconciliation still requires all
 * original observers and zero references. No numeric handle or field adoption.
 */
export const createSqliteCacheCloseOwner = (db, { canClose, onClosed, onNativeClosed = () => {}, allowCacheHandoff = false }) => {
  const captured = nativeSettlements.get(db);
  if (captured) {
    if (captured.owner.lastError) throw captured.owner.lastError;
    throw Object.assign(new Error('SQLite handle already has its original native close owner.'), {
      sqliteCacheOwner: captured.owner, cacheOwnershipPending: true, cacheOwnershipReleased: captured.owner.isSettled
    });
  }
  const failures = [], seen = new Set(), observers = [];
  const settlementHooks = new Set([onNativeClosed]);
  let originalClose, captureFailed = false, disposed = false, closed = false, closing = false;
  let lastError = null, overflow = false, owner, retired = false, nativeConfirmed = false;
  const record = value => {
    const queue = [value];
    while (queue.length) {
      const error = queue.pop();
      if (seen.has(error)) continue;
      if (seen.size === 128) { overflow = true; break; }
      seen.add(error); failures.push(error);
      if (!objectLike(error) || failureOwners.get(error) === owner) continue;
      let observe, marker, unreadable = false;
      try { observe = error.cacheOwnershipReleased; }
      catch (inspection) { unreadable = true; queue.push(inspection); }
      try { marker = error.cacheOwnershipPending; }
      catch (inspection) { unreadable = true; queue.push(inspection); }
      if (unreadable) observers.push(() => false);
      if (marker === true || typeof observe === 'function') observers.push(() => {
        try { return typeof observe === 'function' && observe.call(error) === true; }
        catch (inspection) { record(inspection); return false; }
      });
    }
  };
  const resourcesSettled = () => !overflow && observers.every(observe => observe());
  const isSettled = () => closed && resourcesSettled();
  const describe = () => {
    // Fixed diagnostics avoid invoking arbitrary primary message/stack getters.
    const error = new AggregateError([...failures], 'SQLite cache closure remains unconfirmed.',
      failures.length ? { cause: failures[0] } : undefined);
    Object.defineProperties(error, {
      code: { value: 'ERR_SQLITE_CACHE_CLOSE_PENDING' },
      sqliteCacheOwner: { value: owner },
      cacheOwnershipPending: { get: () => !isSettled() },
      cacheOwnershipReleased: { value: isSettled }
    });
    failureOwners.set(error, owner); lastError = error; pending.add(owner); return error;
  };
  const receipt = () => Object.freeze({ settled: isSettled(), pending: !isSettled() });
  const close = ({ retry = false } = {}) => {
    retired = true; cacheHandoffs.delete(db);
    if (isSettled()) return receipt();
    pending.add(owner);
    if (!canClose()) return receipt();
    if (closing || lastError && !retry) throw lastError || describe();
    if (captureFailed || !resourcesSettled()) throw describe();
    closing = true;
    try {
      if (!disposed) {
        const result = originalClose.call(db);
        if (result === false) throw new Error('SQLite cache close explicitly remained unconfirmed.');
        if (result !== undefined && result !== db) {
          // The installed better-sqlite3 close contract returns its receiver.
          // A Promise or other return value cannot prove synchronous closure.
          if (result instanceof Promise) Promise.prototype.then.call(result, () => {}, error => { record(error); });
          throw Object.assign(new Error('SQLite cache close returned unknown synchronous evidence.'), { cacheOwnershipPending: true });
        }
        disposed = true;
      }
      if (!resourcesSettled()) throw describe();
      nativeConfirmed = true;
      const settlementErrors = [];
      for (const hook of settlementHooks) { try { hook(); } catch (error) { settlementErrors.push(error); } }
      if (settlementErrors.length) throw new AggregateError(settlementErrors, 'SQLite storage settlement failed.', { cause: settlementErrors[0] });
      closed = true; pending.delete(owner); onClosed(); return receipt();
    } catch (error) {
      if (failureOwners.get(error) === owner) throw error;
      record(error); throw describe();
    } finally { closing = false; }
  };
  owner = Object.freeze({ kind: 'sqlite-cache', db, isSettled,
    get lastError() { return lastError; }, retainFailure: record,
    retire: () => close(), release: () => close({ retry: true }) });
  if (objectLike(db)) nativeSettlements.set(db, { owner, settled: () => nativeConfirmed,
    hooks: settlementHooks, retired: () => closing || disposed || captureFailed || lastError !== null });
  try {
    originalClose = db?.close;
    if (typeof originalClose !== 'function') throw new TypeError('SQLite cache requires its original synchronous close method.');
  } catch (error) { captureFailed = true; record(error); throw describe(); }
  if (allowCacheHandoff) cacheHandoffs.set(db, gate => {
    if (retired || lastError || typeof gate?.canClose !== 'function' || typeof gate?.onClosed !== 'function') {
      throw new Error('SQLite cache requires its unused original resource owner.');
    }
    const initialOnClosed = onClosed;
    canClose = gate.canClose;
    onClosed = () => { initialOnClosed(); gate.onClosed(); };
    return owner;
  });
  return owner;
};
