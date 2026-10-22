import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireRepoCacheAccessLease } from '../cache/repo-access.js';
import { getFailedRepoCacheAccessLease } from '../cache/repo-access-reader.js';
import { assertNoSymlinkPath } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';

const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const capturePendingClosure = error => {
  if (!error) return null;
  let observer;
  try { observer = error.cacheOwnershipReleased; } catch { return () => false; }
  if (error.cacheOwnershipPending !== true && typeof observer !== 'function') return null;
  return () => { try { return typeof observer === 'function' && observer.call(error) === true; } catch { return false; } };
};
export const retainSessionFailure = (primary, settlementError, session) => {
  const failure = asError(primary || settlementError);
  const additional = primary && settlementError !== failure ? asError(settlementError) : null;
  const observers = [failure, additional].filter(Boolean).map(capturePendingClosure).filter(Boolean);
  // Capture original function identities before attaching the aggregate observer.
  // The retained session itself still requires its exact explicit settlement.
  const descriptors = {
    cacheOwnershipPending: { value: true, configurable: true, writable: true },
    cacheOwnershipReleased: { value: () => observers.length > 0 && observers.every(observe => observe()), configurable: true, writable: true },
    storageSession: { value: session, configurable: true },
    ...(additional ? { storageSettlementError: { value: additional, configurable: true } } : {})
  };
  try {
    // A nested session keeps its own handle on the exact original cause.
    if (Object.hasOwn(failure, 'storageSession')) throw new Error('Existing session owner must be preserved.');
    Object.defineProperties(failure, descriptors);
    return failure;
  } catch {
    let message = 'Storage resource operation or settlement failed.';
    try { if (typeof failure.message === 'string') message = failure.message; } catch {}
    const aggregate = new AggregateError([failure, ...(additional ? [additional] : [])],
      message, { cause: failure });
    try { if (typeof failure.name === 'string') aggregate.name = failure.name; } catch {}
    // Preserve non-enumerable resource capabilities without invoking getters or
    // replacing the aggregate's exact original cause/errors.
    const existing = Object.getOwnPropertyDescriptors(failure);
    for (const key of Reflect.ownKeys(existing)) {
      if (['cause', 'errors', 'message', 'stack'].includes(key) || Object.hasOwn(descriptors, key)) continue;
      Object.defineProperty(aggregate, key, existing[key]);
    }
    Object.defineProperties(aggregate, descriptors);
    return aggregate;
  }
};

/** Session lifetime is resource lifetime, not request timeout or Promise.race.
 * Metadata uses the existing reader protocol and an explicit owned state root.
 */
export const acquireStorageSession = ({ roots, coordinationRoot, authorizedRoots = [], scope = 'storage-asset-session',
  resourceId = randomUUID() } = {}) => {
  if (!Array.isArray(roots) || !roots.length || roots.length > 64
    || !Array.isArray(authorizedRoots) || !authorizedRoots.length || authorizedRoots.length > 64
    || authorizedRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root))
    || typeof coordinationRoot !== 'string' || !path.isAbsolute(coordinationRoot)
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
  // A whole configured category can move while a child profile/run is active.
  // Pin only ancestors explicitly supplied by the launch authority, using the
  // same exact-root exclusion handshake as category migration. Never discover
  // or authorize arbitrary filesystem parents.
  const protectedRoots = [...new Set([...selected, ...authorizedRoots.map(root => path.resolve(root))
    .filter(approved => selected.some(root => isPathWithinRoot(root, approved)))])].sort();
  const leases = [];
  let released = false;
  const session = Object.freeze({ schemaVersion: 1, resourceId, roots: selected, coordinationRoot: metadataRoot,
    get leaseIds() { return leases.map(lease => lease.leaseId); },
    releaseAfterSettlement: receipt => {
      if (receipt?.resourceId !== resourceId || receipt.settled !== true || receipt.pending !== false) {
        throw Object.assign(new Error('Storage session remains retained until its exact resource lifetime settles.'), { code: 'ERR_STORAGE_SESSION_PENDING', cacheOwnershipPending: true });
      }
      if (released) return true;
      const errors = [];
      for (const lease of leases) {
        try {
          if (!lease.release()) errors.push(Object.assign(new Error('A storage session lease changed before release.'),
            { leaseId: lease.leaseId }));
        } catch (error) { errors.push(asError(error)); }
      }
      if (errors.length) {
        const error = Object.assign(new AggregateError(errors, 'Storage session leases did not all release.', { cause: errors[0] }), {
          code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', cacheOwnershipPending: true, cacheOwnershipReleased: () => released
        });
        Object.defineProperty(error, 'storageSession', { value: session, configurable: true });
        throw error;
      }
      released = true;
      return true;
    } });
  try {
    for (const root of protectedRoots) leases.push(acquireRepoCacheAccessLease(root,
      { coordinationRoot: metadataRoot, scope, resourceId, requireSettlement: true }));
  } catch (error) {
    // No asset work has started, but each admitted metadata lease still needs
    // exact removal. Attempt all and retain the partial owner if any fail.
    const refusedLease = getFailedRepoCacheAccessLease(error);
    if (refusedLease) leases.push(refusedLease);
    try { session.releaseAfterSettlement({ resourceId, settled: true, pending: false }); }
    catch (cleanupError) { throw retainSessionFailure(asError(error), cleanupError, session); }
    throw error;
  }
  return session;
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
    if (operationError?.cacheOwnershipPending === true) {
      const observe = capturePendingClosure(operationError);
      if (receipt?.pending !== false || !observe || !observe()) throw operationError;
    }
    session.releaseAfterSettlement(receipt);
  } catch (settlementError) {
    throw retainSessionFailure(operationError, settlementError, session);
  }
  if (operationError) throw operationError;
  return { value, resourceId: session.resourceId, settled: true };
};
