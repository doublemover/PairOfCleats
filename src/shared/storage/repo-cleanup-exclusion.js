import path from 'node:path';
import { getApplicationHome } from '../cache-roots.js';
import { withExclusiveRepoCacheCleanup } from '../cache/repo-access.js';
import { sameIdentityPath } from '../indexing/build-pointer-roots.js';
import { withExclusiveStorageAccess } from './access.js';
import { runWithStorageSession } from './session.js';
import { observeStorageResource } from './failure-observation.js';
import { addStorageFailureContext } from './operation-error.js';
import { releaseFileLockOrThrow } from '../locks/file-lock.js';
import { retainPublishedFileLockPrerequisite } from '../locks/file-lock-producer-observations.js';

/** Compose the two existing admission namespaces. A repository cleanup must
 * also pin its launch-selected categories against whole-category relocation.
 * The caller still owns classification, writer checks and deletion proof. */
export const withRepoCleanupExclusion = async ({ repoCacheRoot, cacheRoot, action }) => {
  if (!path.isAbsolute(repoCacheRoot) || !path.isAbsolute(cacheRoot)
    || !sameIdentityPath(path.dirname(repoCacheRoot), path.join(cacheRoot, 'repos'))
    || typeof action !== 'function') throw new TypeError('Cleanup requires its exact canonical repository category.');
  const home = getApplicationHome(), state = path.join(home, 'state');
  const coordinationRoot = path.join(state, 'storage-access');
  const result = await runWithStorageSession({ roots: [cacheRoot, path.join(cacheRoot, 'repos')],
    authorizedRoots: [cacheRoot, path.join(cacheRoot, 'repos'), state], coordinationRoot,
    scope: 'repository-cleanup' }, async session => {
    const legacy = await withExclusiveRepoCacheCleanup(repoCacheRoot, async legacyOwner => {
      const modern = await withExclusiveStorageAccess(repoCacheRoot, async modernOwner => {
        // This composition owns ordered release, including a failed operation
        // followed by failed metadata cleanup. Nested finally blocks must not
        // replace the original work failure with the release failure.
        legacyOwner.retainExclusion(); modernOwner.retainExclusion();
        let value, primary, failed = false, observation = null, workPrerequisite = null;
        let modernReleased = false, legacyReleased = false, released = false, closing = null, pendingMetadata = null;
        const releaseOwned = async lock => {
          if (pendingMetadata?.lock === lock) {
            const { session: original, recover, isSettled } = pendingMetadata;
            const receipt = await recover.call(original);
            observeStorageResource(receipt, { phase: 'repository-cleanup-metadata-recovery' }).requireSettled();
            if (receipt?.settled !== true || receipt?.pending !== false || isSettled.call(original) !== true) {
              throw new Error('Original repository cleanup metadata remains unconfirmed.');
            }
            pendingMetadata = null;
          } else {
            try { await releaseFileLockOrThrow(lock, { workerError: workPrerequisite }); }
            catch (failure) {
              const original = lock.fileLockPublicationSession;
              pendingMetadata = { lock, session: original, recover: original.releaseAfterClose, isSettled: original.isSettled };
              throw failure;
            }
          }
        };
        const owner = Object.freeze({ close: () => {
          if (!closing) closing = (async () => {
            observation?.requireSettled();
            if (!modernReleased) { await releaseOwned(modernOwner.lock); modernReleased = true; }
            observation?.requireSettled();
            if (!legacyReleased) { await releaseOwned(legacyOwner.lock); legacyReleased = true; }
            observation?.requireSettled();
            session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
            released = true;
          })().finally(() => { closing = null; });
          return closing;
        } });
        const retain = error => addStorageFailureContext(error, { repoCleanupOwner: owner, cacheOwnershipPending: true,
          cacheOwnershipReleased: () => released }, undefined, { forceAggregate: true, nonEnumerable: ['repoCleanupOwner'] });
        try { value = await action(); observation = observeStorageResource(value, { phase: 'repository-cleanup-result' }); }
        catch (error) { primary = error; failed = true; observation = observeStorageResource(error, { phase: 'repository-cleanup-work' }); }
        workPrerequisite = observation?.hasResourceObservation ? observation.retain() : failed ? primary : null;
        if (observation?.hasResourceObservation) {
          observation = observeStorageResource(workPrerequisite, { phase: 'repository-cleanup-captured-work' });
          for (const lock of [modernOwner.lock, legacyOwner.lock]) retainPublishedFileLockPrerequisite(lock, workPrerequisite);
        }
        try { await owner.close(); }
        catch (error) {
          const combined = failed && error !== primary
            ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
          throw retain(combined);
        }
        if (failed) throw primary;
        return value;
      }, { coordinationRoot });
      return modern;
    });
    return legacy.protected ? legacy : legacy.result;
  }, { settlement: ({ error, resourceId }) => {
    if (error) observeStorageResource(error, { phase: 'repository-cleanup-category-settlement' }).requireSettled();
    return { resourceId, settled: true, pending: false };
  } });
  return result.value;
};
