/** Evaluation owns this cache and display only. Capture their actual methods
 * before work; end both lifetimes before a report can be written or displayed.
 * Cache failure retention adds original work prerequisites, never close authority.
 */
export const runEvaluationResourceScope = async ({ sqliteCache, display }, operation) => {
  const dispose = sqliteCache.dispose, retain = sqliteCache.retainFailure,
    pendingOwners = sqliteCache.pendingOwners, closeDisplay = display.close;
  if (![dispose, retain, pendingOwners, closeDisplay, operation].every(value => typeof value === 'function')) {
    throw new TypeError('Evaluation requires original cache and display lifecycle owners.');
  }
  const failures = [];
  let result, operationFailed = false;
  try { result = await operation(); }
  catch (error) {
    operationFailed = true; failures.push(error);
    try { retain.call(sqliteCache, error); }
    catch (inspection) { failures.push(inspection); }
  }
  // Do not finalize through a failed prerequisite-registration boundary.
  if (failures.length < 2) {
    try {
      if (dispose.call(sqliteCache) !== undefined) throw Object.assign(new Error('Evaluation cache cleanup returned unknown synchronous evidence.'), { cacheOwnershipPending: true });
      const owners = pendingOwners.call(sqliteCache);
      const observations = owners.map(owner => { const observe = owner.isSettled; return () => observe.call(owner) === true; });
      const released = () => observations.every(observe => { try { return observe(); } catch { return false; } });
      if (!released()) throw Object.assign(new Error('Evaluation cache still owns outstanding resources.'), {
        cacheOwnershipPending: true, cacheOwnershipReleased: released, sqliteCacheOwners: Object.freeze([...owners])
      });
    } catch (error) { failures.push(error); }
  }
  try {
    if (closeDisplay.call(display) !== undefined) throw Object.assign(new Error('Evaluation display cleanup returned unknown synchronous evidence.'), { cacheOwnershipPending: true });
  } catch (error) { failures.push(error); }
  if (!failures.length) return result;
  if (failures.length === 1) throw failures[0];
  const observations = [], errors = [...failures];
  let unknown = false;
  for (let index = 0; index < failures.length; index++) {
    const value = failures[index];
    let observe, marker;
    try { observe = value?.cacheOwnershipReleased; marker = value?.cacheOwnershipPending; }
    catch (inspection) { errors.push(inspection); unknown = true; continue; }
    if (typeof observe === 'function') observations.push(() => {
      try { return observe.call(value) === true; } catch { return false; }
    });
    else if (marker === true || !operationFailed || index > 0) unknown = true;
  }
  const failure = new AggregateError(errors, 'Evaluation work or resource cleanup failed.', { cause: failures[0] });
  const released = () => !unknown && observations.every(observe => observe());
  Object.defineProperties(failure, { cacheOwnershipPending: { get: () => !released() },
    cacheOwnershipReleased: { value: released } });
  throw failure;
};
