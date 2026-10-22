import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireRepoCacheAccessLease } from '../cache/repo-access.js';
import { assertNoSymlinkPath } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';

/** Session lifetime is resource lifetime, not request timeout or Promise.race.
 * Metadata uses the existing reader protocol and an explicit owned state root.
 */
export const acquireStorageSession = ({ roots, coordinationRoot, authorizedRoots = [], scope = 'storage-asset-session',
  resourceId = randomUUID() } = {}) => {
  if (!Array.isArray(roots) || !roots.length || roots.length > 64 || typeof coordinationRoot !== 'string' || !path.isAbsolute(coordinationRoot)
    || typeof scope !== 'string' || !scope || scope.length > 128
    || typeof resourceId !== 'string' || !resourceId || resourceId.length > 256) throw new TypeError('Storage session requires roots, owned coordination and bounded resource identity.');
  const metadataRoot = path.resolve(coordinationRoot);
  if (!authorizedRoots.some(root => isPathWithinRoot(metadataRoot, path.resolve(root)))) throw new Error('Session metadata is outside launch-authorized state.');
  assertNoSymlinkPath(path.parse(metadataRoot).root, metadataRoot, { allowMissing: true });
  const selected = [...new Set(roots.map(root => path.resolve(root)))].sort();
  for (const root of selected) {
    if (!authorizedRoots.some(approved => isPathWithinRoot(root, path.resolve(approved)))) throw new Error('Session asset is outside launch-authorized storage.');
    assertNoSymlinkPath(path.parse(root).root, root, { allowMissing: true });
  }
  const leases = [];
  try {
    for (const root of selected) leases.push(acquireRepoCacheAccessLease(root, { coordinationRoot: metadataRoot, scope, resourceId }));
  } catch (error) {
    for (const lease of leases) lease.release();
    throw error;
  }
  let released = false;
  return Object.freeze({ schemaVersion: 1, resourceId, roots: selected, coordinationRoot: metadataRoot,
    leaseIds: leases.map(lease => lease.leaseId),
    releaseAfterSettlement: receipt => {
      if (receipt?.resourceId !== resourceId || receipt.settled !== true || receipt.pending === true) {
        throw Object.assign(new Error('Storage session remains retained until its exact resource lifetime settles.'), { code: 'ERR_STORAGE_SESSION_PENDING', cacheOwnershipPending: true });
      }
      if (released) return true;
      const success = leases.map(lease => lease.release()).every(Boolean);
      if (!success) throw Object.assign(new Error('A storage session lease changed before release.'), { code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', cacheOwnershipPending: true });
      released = true;
      return true;
    } });
};

/** The resource owner interprets its own termination/disposal receipt. Missing,
 * rejected or unconfirmed settlement retains leases and preserves the primary
 * operation error for later reconciliation through the same session handle.
 */
export const runWithStorageSession = async (input, action, { settlement } = {}) => {
  if (typeof action !== 'function' || typeof settlement !== 'function') throw new TypeError('Storage session execution requires action and settlement owners.');
  const session = acquireStorageSession(input);
  let value;
  let operationError = null;
  try { value = await action(session); }
  catch (error) { operationError = error && typeof error === 'object' ? error : new Error(String(error), { cause: error }); }
  try {
    const receipt = await settlement({ value, error: operationError, resourceId: session.resourceId });
    if (operationError?.cacheOwnershipPending === true && receipt?.pending !== false) throw operationError;
    session.releaseAfterSettlement(receipt);
  } catch (settlementError) {
    const error = operationError || settlementError;
    error.cacheOwnershipPending = true;
    Object.defineProperty(error, 'storageSession', { value: session, configurable: true });
    if (settlementError !== error) error.storageSettlementError = settlementError;
    throw error;
  }
  if (operationError) throw operationError;
  return { value, resourceId: session.resourceId, settled: true };
};
