import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isProcessAlive, removeLockFileSyncIfOwned } from '../locks/file-lock-owner.js';
import { readJsonFileSyncSafe } from '../file-read.js';
import { repoAccessPaths, consumeRepoCacheAccessHandoff } from './repo-access-reader.js';
import { assertNoSymlinkPath } from '../contained-file.js';
export { repoAccessPaths, retainRepoCacheAccess, retainCachePathAccess,
  prepareRepoCacheAccessHandoff, cancelRepoCacheAccessHandoff,
  acquireRepoCacheAccessLease } from './repo-access-reader.js';

const readOwner = file => readJsonFileSyncSafe(file, { maxBytes: 64 * 1024 });

/** Unknown/foreign owners stay protected; elapsed time never evicts a live reader. */
export const inspectRepoCacheAccess = (repoCacheRoot, options = {}) => {
  const paths = repoAccessPaths(repoCacheRoot, options);
  let entries;
  try { entries = fs.readdirSync(paths.leases); } catch (error) {
    return error.code === 'ENOENT' ? [] : [{ reason: 'unreadable-leases' }];
  }
  const active = [];
  for (const name of entries) {
    const lease = readOwner(path.join(paths.leases, name));
    if (!lease || lease.hostname !== os.hostname() || !Number.isSafeInteger(lease.pid)
      || lease.pid <= 0 || isProcessAlive(lease.pid)) {
      active.push({ pid: lease?.pid ?? null, reason: !lease ? 'unreadable-lease' : 'process-lease' });
    } else {
      removeLockFileSyncIfOwned(path.join(paths.leases, name), lease);
    }
  }
  return active;
};

export const withExclusiveRepoCacheCleanup = async (repoCacheRoot, action, options = {}) => {
  const { acquireFileLock, releaseFileLockOrThrow } = await import('../locks/file-lock.js');
  const paths = repoAccessPaths(repoCacheRoot, options);
  if (options.coordinationRoot) assertNoSymlinkPath(path.parse(paths.directory).root, paths.directory, { allowMissing: true });
  if (fs.existsSync(paths.lockPath)) {
    const owner = readOwner(paths.lockPath);
    if (!owner || owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
      return { protected: true, reason: 'unknown-cleanup-owner' };
    }
  }
  const lock = await acquireFileLock({ lockPath: paths.lockPath, waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'repo-cache-cleanup', hostname: os.hostname() } });
  if (!lock) return { protected: true, reason: 'cleanup-in-progress' };
  let restoreLocalReader = null;
  try {
    if (options.localAccessHandoff) restoreLocalReader = consumeRepoCacheAccessHandoff(options.localAccessHandoff, paths);
    const owners = inspectRepoCacheAccess(repoCacheRoot, options);
    if (owners.length) return { protected: true, reason: 'active-process-lease', owners };
    return { protected: false, result: await action() };
  } finally {
    // A failed restoration retains exclusion; releasing it would lose the
    // process-lifetime reader's protection while its resources may remain live.
    if (restoreLocalReader) restoreLocalReader();
    await releaseFileLockOrThrow(lock);
  }
};
