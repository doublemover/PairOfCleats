import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createLockPayload } from '../locks/file-lock-info.js';
import { acquireFileLock, isProcessAlive, releaseFileLockOrThrow, removeLockFileSyncIfOwned } from '../locks/file-lock.js';

import { readJsonFileSyncSafe } from '../file-read.js';
import { toRealPathSync } from '../../workspace/identity.js';

const readOwner = (file) => readJsonFileSyncSafe(file, { maxBytes: 64 * 1024 });
const held = new Map();
let exitHookInstalled = false;

export const repoAccessPaths = (repoCacheRoot) => {
  const root = toRealPathSync(repoCacheRoot);
  const identity = process.platform === 'win32' ? root.toLowerCase() : root;
  const key = createHash('sha256').update(identity).digest('hex');
  const directory = path.join(path.dirname(path.dirname(root)), 'repo-access', key);
  return { root, directory, lockPath: path.join(directory, 'cleanup.lock'), leases: path.join(directory, 'leases') };
};

/** Admission precedes any cache access; leases cover retained handles until process exit. */
export const retainRepoCacheAccess = (repoCacheRoot) => {
  const paths = repoAccessPaths(repoCacheRoot);
  if (held.has(paths.directory) && fs.existsSync(held.get(paths.directory))) return;
  fs.mkdirSync(paths.leases, { recursive: true });
  const payload = createLockPayload({ scope: 'repo-cache-access', hostname: os.hostname() });
  const file = path.join(paths.leases, `${payload.lockId}.json`);
  fs.writeFileSync(file, JSON.stringify(payload), { flag: 'wx' });
  // A collector creates its exclusion lock BEFORE inspecting leases. Therefore
  // either it observes our lease, or we observe its lock before touching data.
  if (fs.existsSync(paths.lockPath)) {
    fs.rmSync(file, { force: true });
    throw Object.assign(new Error('Repository cache cleanup is in progress; retry after cleanup completes.'), {
      code: 'ERR_REPO_CACHE_CLEANUP_BUSY'
    });
  }
  held.set(paths.directory, file);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => {
      for (const leaseFile of held.values()) {
        try { fs.rmSync(leaseFile, { force: true }); } catch {}
      }
    });
  }
};

/** Unknown/foreign owners stay protected; elapsed time never evicts a live reader. */
export const inspectRepoCacheAccess = (repoCacheRoot) => {
  const paths = repoAccessPaths(repoCacheRoot);
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

export const withExclusiveRepoCacheCleanup = async (repoCacheRoot, action) => {
  const paths = repoAccessPaths(repoCacheRoot);
  if (fs.existsSync(paths.lockPath)) {
    const owner = readOwner(paths.lockPath);
    if (!owner || owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
      return { protected: true, reason: 'unknown-cleanup-owner' };
    }
  }
  const lock = await acquireFileLock({ lockPath: paths.lockPath, waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'repo-cache-cleanup', hostname: os.hostname() } });
  if (!lock) return { protected: true, reason: 'cleanup-in-progress' };
  try {
    const owners = inspectRepoCacheAccess(repoCacheRoot);
    if (owners.length) return { protected: true, reason: 'active-process-lease', owners };
    return { protected: false, result: await action() };
  } finally {
    await releaseFileLockOrThrow(lock);
  }
};

/** Explicit artifact/database paths still participate in the standard repos/<id> layout. */
export const retainCachePathAccess = (target) => {
  if (typeof target !== 'string' || !target) return;
  let current = toRealPathSync(target);
  while (path.dirname(current) !== current) {
    if (path.basename(path.dirname(current)).toLowerCase() === 'repos') {
      retainRepoCacheAccess(current);
      return;
    }
    current = path.dirname(current);
  }
};
