/** Attempt every exact owner, then preserve the primary failure after all
 * admitted teardown has settled. Promise.all alone can return before siblings.
 */
export const settleOwnedActions = async actions => {
  const results = await Promise.allSettled(Object.values(actions).map(action => Promise.resolve().then(action).catch(error => {
    captureOwnedCleanup(error); throw error;
  })));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw combineOwnedErrors(errors[0], errors.slice(1));
};

/** Only the original exact-handle observer can reconcile pending cleanup. */
export const ownedCleanupIsPending = error => {
  const observation = captureOwnedCleanup(error);
  return observation.present && !observation.released();
};

export const combineOwnedErrors = (primary, cleanup) => {
  const all = [primary, ...cleanup];
  all.forEach(captureOwnedCleanup);
  let code = 'ERR_TUI_OWNER_CLEANUP';
  try { const original = primary?.code; if (typeof original === 'string' && original) code = original; }
  catch (inspection) { all.push(inspection); captureOwnedCleanup(inspection); }
  const pending = all.map(captureOwnedCleanup).filter(observation => observation.present);
  return Object.assign(
    new AggregateError(all, 'Owned execution and cleanup did not both complete.', { cause: primary }),
    { code,
      ...(pending.length ? { cacheOwnershipPending: true,
        cacheOwnershipReleased: () => pending.every(observation => observation.released()) } : {}) });
};
const observations = new WeakMap();
const objectLike = value => value !== null && ['object', 'function'].includes(typeof value);
let captureDepth = 0;

/** Capture before diagnostic callbacks or later owner retries can mutate the
 * original exception. An original observer remains authoritative even when an
 * advisory pending flag is absent/false; unknown observations cannot release.
 */
export const captureOwnedCleanup = error => {
  if (!objectLike(error)) return { present: false, released: () => true };
  const previous = observations.get(error);
  if (previous) return previous;
  let original, marker, unreadable = false, checking = false, overflow = false;
  const inspections = [];
  const retainInspection = inspection => {
    if (inspections.includes(inspection)) return;
    if (inspections.length === 64) overflow = true;
    else { inspections.push(inspection); if (inspection !== error) captureOwnedCleanup(inspection); }
  };
  const observation = { present: false, inspections, released: () => {
    if (!observation.present) return true;
    if (unreadable || overflow || checking || typeof original !== 'function') return false;
    checking = true;
    try {
      if (original.call(error) !== true) return false;
      return inspections.every(inspection => inspection === error || !ownedCleanupIsPending(inspection));
    } catch (inspection) { retainInspection(inspection); return false; }
    finally { checking = false; }
  } };
  observations.set(error, observation);
  if (captureDepth >= 64) { observation.present = true; unreadable = true; return observation; }
  captureDepth++;
  try {
    try { original = error.cacheOwnershipReleased; } catch (inspection) { unreadable = true; retainInspection(inspection); }
    try { marker = error.cacheOwnershipPending; } catch (inspection) { unreadable = true; retainInspection(inspection); }
  } finally { captureDepth--; }
  observation.present = unreadable || marker === true || typeof original === 'function';
  return observation;
};
