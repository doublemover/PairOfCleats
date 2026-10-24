import path from 'node:path';
import { assertIndexCacheLease } from '../../../index/build/cache-lease.js';
import { releaseCacheWriterOwnership } from '../../../index/build/cache-writer-drain.js';
import { addStorageFailureContext, readStorageFailureContext } from '../../../shared/storage/operation-error.js';

const grants = new WeakMap();
/** An in-process owner grant, never reconstructible from a reviewed JSON plan. */
export const createBuildRecoveryGrant = context => {
  assertIndexCacheLease(context.lease, context.repoCacheRoot);
  const grant = Object.freeze({});
  grants.set(grant, context);
  return grant;
};
export const readBuildRecoveryGrant = (grant, root) => {
  if (grant === undefined || grant === null) return null;
  const context = grants.get(grant);
  if (!context || path.relative(path.resolve(context.root), path.resolve(root)) !== '') throw Object.assign(
    new Error('Unrecognized build recovery writer grant.'), { code: 'ERR_RECOVERY_AUTHORITY' });
  assertIndexCacheLease(context.lease, context.repoCacheRoot);
  return context;
};

/** Retain the exact transaction writer when a child is unresolved or native
 * release fails. Explicit reconciliation never retries the child's operation.
 */
export const settleBuildRecoveryWriter = async ({ lease, lock, operationError = null }) => {
  const context = operationError === null ? null : addStorageFailureContext(operationError,
    { recoveryPhase: 'writer-settlement' }, null, { forceAggregate: true });
  const observe = context && Object.getOwnPropertyDescriptor(context, 'cacheOwnershipReleased').value;
  let releaseStarted = false, released = false, releasing = null;
  const releaseNative = async () => {
    releaseStarted = true;
    if (await lock.release() !== true) throw Object.assign(new Error('Recovery writer release was not confirmed.'),
      { code: 'ERR_RECOVERY_WRITER_RELEASE', cacheOwnershipPending: true, cacheOwnershipReleased: () => released });
    released = true;
    return true;
  };
  const release = () => {
    if (releasing) return releasing;
    releasing = Promise.resolve().then(async () => {
      if (observe && (!observe.call(context) || !readStorageFailureContext(context)?.complete)) throw context;
      if (released) return true;
      if (releaseStarted) return releaseNative();
      return releaseCacheWriterOwnership({ lease, release: releaseNative, operationError: context });
    }).finally(() => { releasing = null; });
    return releasing;
  };
  try { return await release(); }
  catch (error) {
    const failure = addStorageFailureContext(context || error, { recoveryPhase: 'writer-retained' }, error,
      { secondaryPresent: error !== context, forceAggregate: true });
    const original = Object.getOwnPropertyDescriptor(failure, 'cacheOwnershipReleased').value;
    Object.defineProperties(failure, { releaseRecoveryWriter: { value: release },
      recoveryWriter: { value: lock }, cacheOwnershipPending: { value: true },
      cacheOwnershipReleased: { value: () => released && original.call(failure) === true } });
    throw failure;
  }
};
