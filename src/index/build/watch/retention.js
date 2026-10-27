import fs from 'node:fs/promises';
import path from 'node:path';
import { getApplicationHome, getCacheRoot } from '../../../shared/cache-roots.js';
import { resolveRepoCacheRootPath } from '../../../shared/repo-paths.js';
import { withExclusiveRepoCacheCleanup } from '../../../shared/cache/repo-access.js';
import { withExclusiveStorageAccess } from '../../../shared/storage/access.js';
import { readCurrentBuildReferences } from '../../../shared/indexing/build-pointer-references.js';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { sameIdentityPath } from '../../../shared/indexing/build-pointer-roots.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { runWithStorageSession } from '../../../shared/storage/session.js';
import { releaseFileLockOrThrow } from '../../../shared/locks/file-lock.js';
import { acquireIndexLock } from '../lock.js';

const retained = (reason, details = {}) => ({ status: 'retained-protected', removed: 0, reason, ...details });

/** The attempt manager owns eligibility. Both existing admission namespaces
 * and the actual promotion lock own exclusion; coarse readers block honestly.
 */
export const withWatchRetentionExclusion = async ({ repoRoot, userConfig, repoCacheRoot, buildsRoot, home, cacheRoot, action }) => {
  const revalidate = () => {
    if (!sameIdentityPath(resolveRepoCacheRootPath(repoRoot, userConfig), repoCacheRoot)
      || !sameIdentityPath(getApplicationHome(), home)
      || !sameIdentityPath(userConfig.cache?.root || getCacheRoot(), cacheRoot)) throw new Error('Watch storage selection changed before retention.');
    assertNoSymlinkPath(path.parse(repoCacheRoot).root, repoCacheRoot);
  };
  revalidate();
  const stateRoot = path.join(home, 'state'), coordinationRoot = path.join(stateRoot, 'storage-access');
  const execution = await runWithStorageSession({ roots: [cacheRoot, path.join(cacheRoot, 'repos')],
    authorizedRoots: [cacheRoot, path.join(cacheRoot, 'repos'), stateRoot], coordinationRoot,
    scope: 'watch-retention-category' }, async categorySession => {
    const legacy = await withExclusiveRepoCacheCleanup(repoCacheRoot, async legacyOwner => {
      const modern = await withExclusiveStorageAccess(repoCacheRoot, async modernOwner => {
        revalidate();
        // Category admission is already exclusively held. The same index lock
        // fences legacy/current publishers without creating a conflicting writer
        // session inside our own exclusion.
        const lock = await acquireIndexLock({ repoCacheRoot, requireSettlement: true,
          metadata: { operation: 'watch-attempt-retention' } });
        if (!lock) return retained('promotion-or-writer-active');
        let primary = null, failed = false, held = false;
        const retain = error => {
          const original = observeStorageResource(error, { phase: 'watch-retention-resource' });
          held = true; legacyOwner.retainExclusion(); modernOwner.retainExclusion();
          let indexReleased = false, modernReleased = false, legacyReleased = false, categoryReleased = false, closing = null;
          let pendingMetadata = null;
          const owner = Object.freeze({ close: () => {
            if (!closing) closing = (async () => {
              original.requireSettled(); pendingMetadata?.requireSettled();
              try {
                if (!indexReleased) { await lock.release(); indexReleased = true; }
                if (!modernReleased) { await releaseFileLockOrThrow(modernOwner.lock); modernReleased = true; }
                if (!legacyReleased) { await releaseFileLockOrThrow(legacyOwner.lock); legacyReleased = true; }
                categorySession.releaseAfterSettlement({ resourceId: categorySession.resourceId, settled: true, pending: false });
                categoryReleased = true;
              } catch (failure) { pendingMetadata = observeStorageResource(failure, { phase: 'watch-retention-metadata-release' }); throw failure; }
            })().finally(() => { closing = null; });
            return closing;
          } });
          return addStorageFailureContext(error, { watchRetentionOwner: owner, cacheOwnershipPending: true,
            cacheOwnershipReleased: () => categoryReleased }, undefined,
          { forceAggregate: true, nonEnumerable: ['watchRetentionOwner'] });
        };
        try {
          revalidate();
          return await action({ readReferences: () => {
            revalidate(); return readCurrentBuildReferences({ repoRoot, repoCacheRoot, buildsRoot });
          },
          remove: async (attempt, identity) => {
            const target = path.resolve(attempt.buildRoot);
            revalidate();
            if (!sameIdentityPath(path.dirname(target), path.join(buildsRoot, 'attempts'))) throw new Error('Watch retention requires a direct owned attempt root.');
            assertNoSymlinkPath(buildsRoot, target);
            const current = await fs.lstat(target, { bigint: true });
            if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Watch attempt directory identity changed before retention.');
            await fs.rm(target, { recursive: true, force: false });
          } });
        } catch (error) {
          primary = error; failed = true;
          const observation = observeStorageResource(error, { phase: 'watch-retention-work' });
          let settled = false; try { settled = observation.isSettled(); } catch {}
          throw settled ? error : retain(error);
        }
        finally {
          try { if (!held) await lock.release(); }
          catch (error) {
            const combined = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
            throw retain(combined);
          }
        }
      }, { coordinationRoot });
      return modern.protected ? retained(modern.reason, { owners: modern.owners }) : modern.result;
    });
    return legacy.protected ? retained(legacy.reason, { owners: legacy.owners }) : legacy.result;
  }, { settlement: ({ error, resourceId }) => {
    if (error) observeStorageResource(error, { phase: 'watch-retention-category-settlement' }).requireSettled();
    return { resourceId, settled: true, pending: false };
  } });
  return execution.value;
};
