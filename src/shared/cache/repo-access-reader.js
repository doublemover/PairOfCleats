import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createLockPayload, readLockInfoSync, isLocalProcessDefinitelyDead,
  removeLockFileSyncIfOwned } from '../locks/file-lock-info.js';
import { toRealPathSync } from '../../workspace/identity.js';
import { assertNoSymlinkPath } from '../contained-file.js';
import { assertNoRepoCacheDelegation } from './repo-access-delegation-guard.js';

const held = new Map();
const scoped = new Map();
const handoffs = new WeakMap();
const delegated = new Map();
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
  assertNoRepoCacheDelegation(paths);
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
    // Recheck before stale-parent recovery, not only before collection. A
    // delegated child outlives the parent's PID and must keep readers fenced.
    try { assertNoRepoCacheDelegation(paths); }
    catch (error) { removeLockFileSyncIfOwned(file, payload); throw error; }
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
  try { assertNoRepoCacheDelegation(paths); }
  catch (error) { removeLockFileSyncIfOwned(file, payload); throw error; }
  installExitHook();
  return { file, payload, paths, suspended: false };
};

export const retainRepoCacheAccess = (repoCacheRoot, options = {}) => {
  const paths = repoAccessPaths(repoCacheRoot, options);
  if (delegated.has(paths.directory)) { delegated.get(paths.directory).assertAdmission(); return; }
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
  if (delegated.has(paths.directory)) throw new Error('A delegated native owner cannot create independent scoped readers before settlement.');
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
  let restored = false;
  return ({ resume = true } = {}) => {
    if (!restored) {
      fs.writeFileSync(handoff.lease.file, JSON.stringify(handoff.lease.payload), { flag: 'wx' });
      restored = true;
    } else if (readLockInfoSync(handoff.lease.file)?.lockId !== handoff.lease.payload.lockId) {
      throw new Error('Restored parent reader lease changed before settlement.');
    }
    handoff.lease.suspended = !resume;
    if (resume) handoffs.delete(token);
  };
};

// Internal admission owner registers a process-local closure after the IPC
// capability is claimed. Serialized metadata cannot reconstruct this closure.
export const registerDelegatedRepoCacheReader = (paths, admission) => {
  if (held.has(paths.directory) || delegated.has(paths.directory) || typeof admission?.assertAdmission !== 'function') {
    throw new Error('Delegated admission must precede every canonical cache reader.');
  }
  delegated.set(paths.directory, admission);
  return () => delegated.delete(paths.directory);
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
