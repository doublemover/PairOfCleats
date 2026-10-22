import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createLockPayload, readLockInfoSync, isLocalProcessDefinitelyDead,
  removeLockFileSyncIfOwned } from '../locks/file-lock-info.js';
import { toRealPathSync } from '../../workspace/identity.js';
import { assertNoSymlinkPath } from '../contained-file.js';

const held = new Map();
const scoped = new Map();
const handoffs = new WeakMap();
let exitHookInstalled = false;

const installExitHook = () => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const lease of [...held.values(), ...scoped.values()]) {
      try { removeLockFileSyncIfOwned(lease.file, lease.payload); } catch {}
    }
  });
};

export const repoAccessPaths = (repoCacheRoot, { coordinationRoot = null } = {}) => {
  const root = toRealPathSync(repoCacheRoot);
  const identity = process.platform === 'win32' ? root.toLowerCase() : root;
  const key = createHash('sha256').update(identity).digest('hex');
  if (coordinationRoot !== null && (typeof coordinationRoot !== 'string' || !path.isAbsolute(coordinationRoot))) {
    throw new TypeError('Storage access coordinationRoot must be an absolute launch-selected path.');
  }
  const directory = coordinationRoot ? path.join(path.resolve(coordinationRoot), key)
    : path.join(path.dirname(path.dirname(root)), 'repo-access', key);
  return { root, directory, lockPath: path.join(directory, 'cleanup.lock'), leases: path.join(directory, 'leases') };
};

/** Admission precedes any cache access; leases cover retained handles until process exit. */
const createAccessLease = (paths, options = {}) => {
  if (options.coordinationRoot) assertNoSymlinkPath(path.parse(paths.directory).root, paths.directory, { allowMissing: true });
  fs.mkdirSync(paths.leases, { recursive: true });
  const payload = createLockPayload({ scope: options.scope || 'repo-cache-access', hostname: os.hostname(),
    ...(typeof options.resourceId === 'string' ? { resourceId: options.resourceId } : {}) });
  const file = path.join(paths.leases, `${payload.lockId}.json`);
  fs.writeFileSync(file, JSON.stringify(payload), { flag: 'wx' });
  // A collector creates its exclusion lock BEFORE inspecting leases. Therefore
  // either it observes our lease, or we observe its lock before touching data.
  if (fs.existsSync(paths.lockPath)) {
    const owner = readLockInfoSync(paths.lockPath);
    if (owner?.hostname === os.hostname() && Number.isSafeInteger(owner.pid)
      && owner.pid > 0 && isLocalProcessDefinitelyDead(owner.pid)) {
      removeLockFileSyncIfOwned(paths.lockPath, owner);
    }
  }
  if (fs.existsSync(paths.lockPath)) {
    removeLockFileSyncIfOwned(file, payload);
    throw Object.assign(new Error('Repository cache cleanup is in progress; retry after cleanup completes.'), {
      code: 'ERR_REPO_CACHE_CLEANUP_BUSY'
    });
  }
  installExitHook();
  return { file, payload, paths, suspended: false };
};

export const retainRepoCacheAccess = (repoCacheRoot, options = {}) => {
  const paths = repoAccessPaths(repoCacheRoot, options);
  const current = held.get(paths.directory);
  if (current?.suspended) throw Object.assign(new Error('Local cache readers are drained for an exclusive owner handoff.'), {
    code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED'
  });
  if (current && fs.existsSync(current.file)) return;
  held.set(paths.directory, createAccessLease(paths, options));
};

/** Scoped assets use the identical reader/collector exclusion handshake, but
 * release only their own exact lease after the owning resource confirms close.
 */
export const acquireRepoCacheAccessLease = (repoCacheRoot, options = {}) => {
  const paths = repoAccessPaths(repoCacheRoot, options);
  if (held.get(paths.directory)?.suspended) throw Object.assign(new Error('Local cache access is suspended for an exclusive handoff.'), {
    code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED'
  });
  const lease = createAccessLease(paths, options);
  scoped.set(lease.file, lease);
  let released = false;
  return Object.freeze({ root: paths.root, leaseId: lease.payload.lockId,
    release: () => {
      if (released) return true;
      if (!removeLockFileSyncIfOwned(lease.file, lease.payload)) return false;
      released = true;
      scoped.delete(lease.file);
      return true;
    } });
};

/** Suspend new local admissions before draining handles; the exact lease stays
 * present until the existing exclusive owner has acquired its exclusion lock.
 * This token is process-local and cannot be reconstructed from JSON or --force.
 */
export const prepareRepoCacheAccessHandoff = async (repoCacheRoot, { coordinationRoot = null, drain } = {}) => {
  const paths = repoAccessPaths(repoCacheRoot, { coordinationRoot });
  const lease = held.get(paths.directory);
  if (!lease || lease.suspended || typeof drain !== 'function') throw new Error('Handoff requires one retained local lease and an explicit reader-drain owner.');
  lease.suspended = true;
  try {
    const receipt = await drain({ root: paths.root, leaseId: lease.payload.lockId });
    if (receipt?.drained !== true || receipt?.pending === true || receipt?.leaseId !== lease.payload.lockId) {
      throw new Error('Reader-drain receipt does not confirm this exact retained lease.');
    }
    const token = Object.freeze({ root: paths.root, leaseId: lease.payload.lockId, kind: 'local-cache-access-handoff' });
    handoffs.set(token, { lease, paths, consumed: false });
    return token;
  } catch (error) { lease.suspended = false; throw error; }
};

export const cancelRepoCacheAccessHandoff = token => {
  const handoff = handoffs.get(token);
  if (!handoff || handoff.consumed) return false;
  handoff.lease.suspended = false;
  handoffs.delete(token);
  return true;
};

/** Called only after cleanup.lock is owned; restore the reader before releasing
 * exclusion even on failure. Child-process admission is a separate handoff and
 * cannot inherit this in-process drain token.
 */
export const consumeRepoCacheAccessHandoff = (token, paths) => {
  const handoff = handoffs.get(token);
  if (!handoff || handoff.consumed || handoff.paths.directory !== paths.directory || !handoff.lease.suspended) {
    throw new Error('Invalid or stale local cache access handoff.');
  }
  if (!removeLockFileSyncIfOwned(handoff.lease.file, handoff.lease.payload)) throw new Error('Retained reader lease identity changed before handoff.');
  handoff.consumed = true;
  return () => {
    fs.writeFileSync(handoff.lease.file, JSON.stringify(handoff.lease.payload), { flag: 'wx' });
    handoff.lease.suspended = false;
    handoffs.delete(token);
  };
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
