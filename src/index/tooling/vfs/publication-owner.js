import path from 'node:path';
import os from 'node:os';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { withFileLock } from '../../../shared/locks/file-lock.js';
import { inspectRepoCacheAccess, repoAccessPaths } from '../../../shared/cache/repo-access.js';
import { isKnownRepoAccessOwner } from '../../../shared/cache/repo-access-owner.js';
import { isLocalProcessDefinitelyDead, removeLockFileSyncIfOwned } from '../../../shared/locks/file-lock-info.js';
import { acquireStorageSession } from '../../../shared/storage/session.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { isPathWithinRoot } from '../../../shared/file-paths.js';

const conflict = () => Object.assign(new Error('Another process owns VFS publication or an existing materialization.'), {
  code: 'ERR_VFS_MATERIALIZATION_CONFLICT'
});

/** Reuse the existing reader/exclusion metadata protocol for exact document
 * pins. Coordination is beneath the actual VFS root, shared across launch homes.
 * No publication pin grants root deletion or content authority. */
const acquireDocumentPin = (root, target, coordinationRoot, isClosed) => {
  if (typeof isClosed !== 'function') throw new TypeError('VFS pin requires its original lifetime observer.');
  const original = observeStorageResource(observeStorageResource(Object.freeze({ cacheOwnershipPending: true,
    cacheOwnershipReleased: () => isClosed() === true }), { phase: 'vfs-original-document-lifetime' }).retain(),
  { phase: 'vfs-original-document-lifetime' });
  assertNoSymlinkPath(root, target, { allowMissing: true });
  // Canonical category/root admission belongs to the original provider session.
  // This guard adds one exact document pin, not another root lease per document.
  const session = acquireStorageSession({ roots: [target], authorizedRoots: [target, path.dirname(coordinationRoot)], coordinationRoot,
    scope: 'vfs-original-document-lifetime' });
  let released = false, owner;
  owner = Object.freeze({ isReleased: () => released,
    releaseAfterClosure() {
      if (released) return true;
      try {
        original.requireSettled();
        session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
        released = true; return true;
      } catch (error) {
        throw addStorageFailureContext(error, { vfsPublicationOwner: owner, cacheOwnershipPending: true,
          cacheOwnershipReleased: () => released && original.isSettled() }, null,
        { forceAggregate: true, nonEnumerable: ['vfsPublicationOwner'] });
      }
    }
  });
  return owner;
};

/** Serialize only descriptor qualification/pin admission/publication. A shared
 * durable exact-file resource lease then protects each original provider life.
 * Equal content can share pins; different content needs zero existing pins.
 * Unknown/dead resource owners remain protected by the existing protocol. */
export const withVfsPublicationAdmission = async ({ root, target }, action) => {
  const metadata = path.join(root, '.poc-vfs-access');
  const coordinationRoot = path.join(metadata, 'readers');
  const paths = repoAccessPaths(target, { coordinationRoot });
  if (isPathWithinRoot(paths.root, repoAccessPaths(metadata).root)) throw Object.assign(
    new Error('VFS documents cannot address their publication coordination namespace.'), { code: 'ERR_VFS_MATERIALIZATION_PATH' });
  const key = path.basename(paths.directory);
  const lockPath = path.join(metadata, 'writers', `${key}.lock`);
  assertNoSymlinkPath(root, lockPath, { allowMissing: true });
  let active = true;
  try {
    const admitted = await withFileLock({ lockPath, waitMs: 0, staleMs: Number.MAX_SAFE_INTEGER,
      metadata: { scope: 'vfs-document-publication', hostname: os.hostname() },
      staleRemovalImpl: async ({ lockPath, info }) => ({ removed: Boolean(isKnownRepoAccessOwner(info)
        && info.scope === 'vfs-document-publication' && isLocalProcessDefinitelyDead(info.pid)
        && removeLockFileSyncIfOwned(lockPath, info)), removalMode: 'owner' }) }, async () => {
      assertNoSymlinkPath(root, lockPath);
      const requireActive = () => { if (!active) throw new TypeError('VFS publication admission has retired.'); };
      let pinned = false;
      return { value: await action(Object.freeze({
        assertWritable() {
          requireActive();
          if (inspectRepoCacheAccess(target, { coordinationRoot }).length) throw conflict();
        },
        pin(isClosed) {
          requireActive(); if (pinned) throw new TypeError('VFS publication already has its original pin.');
          pinned = true; return acquireDocumentPin(root, target, coordinationRoot, isClosed);
        }
      })) };
    });
    if (!admitted) throw conflict();
    return admitted.value;
  } finally { active = false; }
};
