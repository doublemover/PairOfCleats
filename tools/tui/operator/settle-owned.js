/** Attempt every exact owner, then preserve the primary failure after all
 * admitted teardown has settled. Promise.all alone can return before siblings.
 */
export const settleOwnedActions = async actions => {
  const results = await Promise.allSettled(Object.values(actions).map(action => Promise.resolve().then(action)));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw combineOwnedErrors(errors[0], errors.slice(1));
};

/** Only the original exact-handle observer can reconcile pending cleanup. */
export const ownedCleanupIsPending = error => {
  if (error?.cacheOwnershipPending !== true) return false;
  try { return error.cacheOwnershipReleased?.() !== true; }
  catch { return true; }
};

export const combineOwnedErrors = (primary, cleanup) => {
  const pending = [primary, ...cleanup].filter(error => error?.cacheOwnershipPending === true);
  return Object.assign(
    new AggregateError([primary, ...cleanup], 'Owned execution and cleanup did not both complete.', { cause: primary }),
    { code: primary?.code || 'ERR_TUI_OWNER_CLEANUP',
      ...(pending.length ? { cacheOwnershipPending: true,
        cacheOwnershipReleased: () => pending.every(error => !ownedCleanupIsPending(error)) } : {}) });
};
