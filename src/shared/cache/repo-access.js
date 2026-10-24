import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { removeLockFileSyncIfOwned, isLocalProcessDefinitelyDead } from '../locks/file-lock-info.js';
import { repoAccessPaths, consumeRepoCacheAccessHandoff } from './repo-access-reader.js';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from '../contained-file.js';
import { inspectRepoCacheDelegation } from './repo-access-delegation-guard.js';
import { isKnownRepoAccessOwner, isKnownRepoResourceOwner } from './repo-access-owner.js';
export { repoAccessPaths, retainRepoCacheAccess, retainCachePathAccess,
  prepareRepoCacheAccessHandoff, cancelRepoCacheAccessHandoff,
  acquireRepoCacheAccessLease } from './repo-access-reader.js';

const readOwner = file => {
  try { return JSON.parse(readVerifiedContainedFileSync(path.parse(file).root, file, { maxBytes: 64 * 1024 }).buffer.toString('utf8')); }
  catch { return null; }
};

/** Unknown/foreign owners stay protected; elapsed time never evicts a live reader. */
export const inspectRepoCacheAccess = (repoCacheRoot, options = {}) => {
  const paths = repoAccessPaths(repoCacheRoot, options);
  const delegation = inspectRepoCacheDelegation(paths);
  if (delegation.protected) return [{ reason: delegation.reason }];
  let directory;
  try {
    assertNoSymlinkPath(path.parse(paths.directory).root, paths.leases, { allowMissing: true });
    directory = fs.opendirSync(paths.leases);
  } catch (error) {
    return error.code === 'ENOENT' ? [] : [{ reason: 'unreadable-leases' }];
  }
  const active = [];
  try {
    for (let count = 0; ; count += 1) {
      const entry = directory.readSync();
      if (!entry) break;
      if (count >= 10000) { active.push({ reason: 'lease-inventory-budget' }); break; }
      const file = path.join(paths.leases, entry.name);
      const lease = entry.isFile() ? readOwner(file) : null;
      if (isKnownRepoResourceOwner(lease) && entry.name === `${lease.lockId}.json`) {
        active.push({ pid: lease.pid, resourceId: lease.resourceId, reason: 'resource-settlement-unconfirmed' });
      } else if (!isKnownRepoAccessOwner(lease) || entry.name !== `${lease.lockId}.json` || !isLocalProcessDefinitelyDead(lease.pid)) {
        active.push({ pid: lease?.pid ?? null, reason: !lease ? 'unreadable-lease' : 'live-or-unknown-process-lease' });
      } else if (!removeLockFileSyncIfOwned(file, lease)) {
        active.push({ pid: lease.pid, reason: 'lease-identity-changed' });
      }
    }
  } catch (error) { active.push({ reason: 'unreadable-leases', code: error.code }); }
  finally {
    try { directory.closeSync(); }
    catch (error) { active.push({ reason: 'lease-inventory-close-unconfirmed', code: error.code }); }
  }
  return active;
};

export const withExclusiveRepoCacheCleanup = async (repoCacheRoot, action, options = {}) => {
  const { acquireFileLock, releaseFileLockOrThrow } = await import('../locks/file-lock.js');
  const paths = repoAccessPaths(repoCacheRoot, options);
  const delegation = inspectRepoCacheDelegation(paths);
  if (delegation.protected) return { protected: true, reason: delegation.reason };
  try { assertNoSymlinkPath(path.parse(paths.directory).root, paths.lockPath, { allowMissing: true }); }
  catch (error) { return { protected: true, reason: 'unsafe-or-unknown-coordination-root', code: error.code }; }
  if (fs.existsSync(paths.lockPath)) {
    const owner = readOwner(paths.lockPath);
    if (!isKnownRepoAccessOwner(owner)) {
      return { protected: true, reason: 'unknown-cleanup-owner' };
    }
  }
  const lock = await acquireFileLock({ lockPath: paths.lockPath, waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'repo-cache-cleanup', hostname: os.hostname() },
    staleRemovalImpl: async ({ lockPath, info }) => {
      if (inspectRepoCacheDelegation(paths).protected || !isKnownRepoAccessOwner(info) || !isLocalProcessDefinitelyDead(info.pid)) {
        return { removed: false, removalMode: 'owner' };
      }
      // Existing exact-owner removal only. Stable age and failed owner removal
      // never fall back to force-removing a different/unknown exclusion owner.
      return { removed: removeLockFileSyncIfOwned(lockPath, info), removalMode: 'owner' };
    } });
  if (!lock) return { protected: true, reason: 'cleanup-in-progress' };
  let restoreLocalReader = null;
  let retained = false;
  try {
    const currentDelegation = inspectRepoCacheDelegation(paths);
    if (currentDelegation.protected) return { protected: true, reason: currentDelegation.reason };
    if (options.localAccessHandoff) restoreLocalReader = consumeRepoCacheAccessHandoff(options.localAccessHandoff, paths);
    const owners = inspectRepoCacheAccess(repoCacheRoot, options);
    if (owners.length) return { protected: true, reason: 'active-process-lease', owners };
    return { protected: false, result: await action({ paths, lock,
      retainExclusion: () => { retained = true; } }) };
  } finally {
    // A failed restoration retains exclusion; releasing it would lose the
    // process-lifetime reader's protection while its resources may remain live.
    if (restoreLocalReader) restoreLocalReader({ resume: !retained });
    if (!retained) await releaseFileLockOrThrow(lock);
  }
};
