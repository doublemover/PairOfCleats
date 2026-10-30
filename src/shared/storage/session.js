import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireRepoCacheAccessLease } from '../cache/repo-access.js';
import { getFailedRepoCacheAccessLease } from '../cache/repo-access-reader.js';
import { assertNoSymlinkPath } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { observeStorageResource } from './failure-observation.js';
import { addStorageFailureContext } from './operation-error.js';

const leaseReleaseFailures = new WeakMap();
/** Distinguish our exact failed metadata release from independent resource
 * failures. Codes, copied properties and serialized handles grant no authority. */
export const isStorageSessionReleaseFailure = (error, session) => Boolean(session)
  && leaseReleaseFailures.get(error) === session;

const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
export const retainSessionFailure = (primary, settlementError, session, {
  originalClosure = null, resourceObservation = null, primaryPresent = primary !== null && primary !== undefined
} = {}) => {
  const failure = asError(primaryPresent ? primary : settlementError);
  const additional = primaryPresent && settlementError !== primary ? asError(settlementError) : null;
  // The common composer retains callback/marker/descriptor inspection failures
  // and original receivers. Its context is built before touching the primary.
  let context = addStorageFailureContext(failure, {}, additional, { secondaryPresent: additional !== null, forceAggregate: true });
  if (resourceObservation) context = addStorageFailureContext(context, {}, resourceObservation, { secondaryPresent: true });
  if (typeof originalClosure === 'function') context = addStorageFailureContext(context, {}, Object.freeze({
    cacheOwnershipPending: true, cacheOwnershipReleased: originalClosure
  }), { secondaryPresent: true });
  const fields = { storageSession: session, ...(additional ? { storageSettlementError: additional } : {}) };
  const descriptorsFor = value => {
    const retained = observeStorageResource(value, { phase: 'storage-session-failure' }).retain();
    const captured = Object.getOwnPropertyDescriptor(retained, 'cacheOwnershipReleased').value;
    return {
      cacheOwnershipPending: { value: true, configurable: false, writable: false },
      cacheOwnershipReleased: { value: () => captured.call(retained) === true, configurable: false, writable: false },
      storageSession: { value: session, configurable: true },
      storageFailureObservation: { value: retained, configurable: true },
      ...(additional ? { storageSettlementError: { value: additional, configurable: true } } : {})
    };
  };
  try {
    // A nested session keeps its own handle on the exact original cause.
    if (Object.hasOwn(failure, 'storageSession')) throw new Error('Existing session owner must be preserved.');
    Object.defineProperties(failure, descriptorsFor(context));
    return failure;
  } catch (inspection) {
    // Ordinary frozen/existing-owner fallback is represented by the common
    // composer, including exact original capabilities and inspection evidence.
    context = addStorageFailureContext(context, {}, inspection, { secondaryPresent: true, forceAggregate: true });
    const aggregate = addStorageFailureContext(failure, { ...fields, storageFailureObservation: null }, context,
      { secondaryPresent: true, forceAggregate: true, nonEnumerable: Object.keys(fields).concat('storageFailureObservation') });
    Object.defineProperties(aggregate, { ...descriptorsFor(aggregate),
      cause: { value: failure, configurable: true, writable: true } });
    return aggregate;
  }
};

export const captureSettlementReceipt = receipt => {
  const observation = observeStorageResource(receipt, { phase: 'storage-session-receipt' });
  observation.requireSettled();
  let captured;
  try { captured = Object.freeze({ resourceId: receipt?.resourceId, settled: receipt?.settled, pending: receipt?.pending }); }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return { receipt: captured, requireSettled: observation.requireSettled };
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
  const adoptLease = (root, lease) => {
    const originalRelease = lease.release;
    leases.push({ root, leaseId: lease.leaseId, released: false, observation: null,
      release: () => originalRelease.call(lease) });
  };
  let released = false;
  const session = Object.freeze({ schemaVersion: 1, resourceId, roots: selected, coordinationRoot: metadataRoot,
    get leaseIds() { return leases.map(lease => lease.leaseId); },
    releaseAfterSettlement: receipt => {
      const captured = captureSettlementReceipt(receipt);
      if (captured.receipt.resourceId !== resourceId || captured.receipt.settled !== true || captured.receipt.pending !== false) {
        throw Object.assign(new Error('Storage session remains retained until its exact resource lifetime settles.'), { code: 'ERR_STORAGE_SESSION_PENDING', cacheOwnershipPending: true });
      }
      if (released) return true;
      const errors = [];
      const blockedRoots = [];
      // Retire descendants before their explicitly admitted category ancestors.
      // Independent siblings still get their own release attempt. Successful
      // original releases are never replayed during metadata reconciliation.
      for (const lease of [...leases].sort((left, right) => right.root.length - left.root.length)) {
        if (lease.released || blockedRoots.some(root => isPathWithinRoot(root, lease.root))) continue;
        try {
          lease.observation?.requireSettled();
          if (lease.release() !== true) throw Object.assign(new Error('A storage session lease changed before release.'),
            { leaseId: lease.leaseId });
          lease.released = true;
        } catch (error) {
          lease.observation = observeStorageResource(observeStorageResource(error,
            { phase: 'storage-session-metadata-release' }).retain(), { phase: 'storage-session-metadata-release' });
          errors.push(lease.observation.retain()); blockedRoots.push(lease.root);
        }
      }
      if (errors.length) {
        const error = Object.assign(new AggregateError(errors, 'Storage session leases did not all release.', { cause: errors[0] }), {
          code: 'ERR_STORAGE_SESSION_LEASE_CHANGED', cacheOwnershipPending: true, cacheOwnershipReleased: () => released
        });
        Object.defineProperty(error, 'storageSession', { value: session, configurable: true });
        leaseReleaseFailures.set(error, session);
        throw error;
      }
      released = true;
      return true;
    } });
  let admittingRoot = null;
  try {
    for (const root of protectedRoots) {
      admittingRoot = root;
      adoptLease(root, acquireRepoCacheAccessLease(root,
        { coordinationRoot: metadataRoot, scope, resourceId, requireSettlement: true }));
    }
  } catch (error) {
    // No asset work has started, but each admitted metadata lease still needs
    // exact removal. Attempt all and retain the partial owner if any fail.
    const refusedLease = getFailedRepoCacheAccessLease(error);
    if (refusedLease) adoptLease(admittingRoot, refusedLease);
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
  let value, operationFailed = false;
  let operationError = null;
  try { value = await action(session); }
  catch (error) { operationFailed = true; operationError = asError(error); }
  // Capture before calling the settlement owner: a callback cannot replace an
  // existing resource observer or erase it by changing the separate marker.
  const original = observeStorageResource(operationFailed ? operationError : value, { phase: 'storage-session-action' });
  const resourceObservation = original.retain();
  const capturedResource = observeStorageResource(resourceObservation, { phase: 'storage-session-captured-action' });
  try {
    const settlementInput = { value, error: operationError, resourceId: session.resourceId };
    Object.defineProperty(settlementInput, 'resourceObservation', { value: capturedResource });
    const receipt = await settlement(settlementInput);
    const captured = captureSettlementReceipt(receipt);
    original.requireSettled();
    captured.requireSettled();
    original.requireSettled();
    session.releaseAfterSettlement(captured.receipt);
  } catch (settlementError) {
    throw retainSessionFailure(operationError, settlementError, session, { resourceObservation, primaryPresent: operationFailed });
  }
  if (operationFailed) throw operationError;
  return { value, resourceId: session.resourceId, settled: true };
};
