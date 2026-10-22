import { entryMatchesTrackedFilters, trackedSubprocesses } from './tracking-runtime.js';

/** A fulfilled kill request is not a release receipt. Keep unknown/failed
 * ownership behind the cache-writer barrier, including zero-error audits that
 * explicitly report an unconfirmed target. */
export const assertSubprocessTerminationReceipt = (receipt, { ownershipPrefix = null } = {}) => {
  const remaining = [...trackedSubprocesses.values()].filter(entry => entryMatchesTrackedFilters(entry, {
    ownershipPrefix: ownershipPrefix || receipt?.ownershipPrefix,
    ownershipId: receipt?.ownershipId
  })).length;
  const confirmed = receipt && Number.isSafeInteger(receipt.tracked) && receipt.tracked >= 0
    && Number.isSafeInteger(receipt.failures) && receipt.failures === 0
    && Array.isArray(receipt.killAudit) && receipt.killAudit.length === receipt.tracked
    && (!ownershipPrefix || receipt.ownershipPrefix === ownershipPrefix)
    && remaining === 0 && receipt.killAudit.every(row => row?.terminated === true && !row.error
      && (!ownershipPrefix || (typeof row.ownershipId === 'string' && row.ownershipId.startsWith(ownershipPrefix))
        || (typeof row.scope === 'string' && row.scope.startsWith(ownershipPrefix))));
  if (!confirmed) throw Object.assign(new Error('Subprocess termination remains failed or unconfirmed.'), {
    code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE', cacheOwnershipPending: true,
    terminationReceipt: receipt, ownershipPrefix, remaining
  });
  return receipt;
};
