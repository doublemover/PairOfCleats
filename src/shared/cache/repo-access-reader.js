import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createLockPayload, readLockInfoSync, isLocalProcessDefinitelyDead,
  removeLockFileSyncIfOwned } from '../locks/file-lock-info.js';
import { toRealPathSync } from '../../workspace/identity.js';
import { assertNoSymlinkPath } from '../contained-file.js';
import { assertNoRepoCacheDelegation } from './repo-access-delegation-guard.js';
import { isKnownRepoAccessOwner } from './repo-access-owner.js';

const held = new Map();
const scoped = new Map();
const handoffs = new WeakMap();
const delegated = new Map();
const failedAdmissions = new WeakMap();
let exitHookInstalled = false;

const unconfirmedResourcePublication = ({ file, payload, primary, closeError, hasPrimary, closeFailed, sealed }) => {
  const first = hasPrimary ? primary : closeError;
  const errors = [...(hasPrimary ? [primary] : []), ...(closeFailed ? [closeError] : [])];
  let message = 'Cache resource lease publication remains unconfirmed.';
  try { if (typeof first?.message === 'string') message = first.message; } catch {}
  const failure = new AggregateError(errors, message, { cause: first });
  if (first && (typeof first === 'object' || typeof first === 'function')) {
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cleanupError',
      'cacheOwnershipPending', 'cacheOwnershipReleased', 'repoCacheAccessPublication']);
    const descriptors = Object.getOwnPropertyDescriptors(first);
    for (const key of Reflect.ownKeys(descriptors)) if (!reserved.has(key)) Object.defineProperty(failure, key, descriptors[key]);
    if (!Object.hasOwn(failure, 'name')) { try { if (typeof first.name === 'string') failure.name = first.name; } catch {} }
  }
  if (!Object.hasOwn(failure, 'code')) failure.code = 'ERR_REPO_CACHE_LEASE_PUBLICATION_PENDING';
  Object.defineProperties(failure, {
    cacheOwnershipPending: { value: true },
    cacheOwnershipReleased: { value: () => false },
    ...(hasPrimary && closeFailed ? { cleanupError: { value: closeError } } : {}),
    repoCacheAccessPublication: { value: Object.freeze({ file, leaseId: payload.lockId,
      resourceId: payload.resourceId, sealed, descriptorCloseObserved: !closeFailed, admission: 'unconfirmed' }) }
  });
  return failure;
};

const installExitHook = () => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const lease of [...held.values(), ...scoped.values()]) {
      // The initiating PID can exit before an external child or teardown owner.
      // Only the exact scoped release capability may remove a resource lease.
      if (lease.payload.resourceSettlementVersion === 1) continue;
      try { removeLockFileSyncIfOwned(lease.file, lease.payload); } catch {}
    }
  });
};

const scopedLeaseHandle = lease => {
  scoped.set(lease.file, lease);
  installExitHook();
  let released = false;
  const handle = { root: lease.paths.root, leaseId: lease.payload.lockId,
    release: () => {
      if (released) return true;
      if (!removeLockFileSyncIfOwned(lease.file, lease.payload)) return false;
      released = true;
      scoped.delete(lease.file);
      return true;
    } };
  Object.defineProperty(handle, 'released', { get: () => released });
  return Object.freeze(handle);
};

/** Only the actual failed admission can yield this process-local capability. */
export const getFailedRepoCacheAccessLease = error => failedAdmissions.get(error) || null;

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

/** Admission precedes cache access. Ordinary readers last until process exit;
 * resource owners require their separate explicit settlement capability.
 */
const createAccessLease = (paths, options = {}) => {
  if (options.requireSettlement === true && (typeof options.resourceId !== 'string'
    || !options.resourceId || options.resourceId.length > 256)) {
    throw new TypeError('Resource settlement admission requires an exact bounded resource identity.');
  }
  assertNoRepoCacheDelegation(paths);
  try { assertNoSymlinkPath(path.parse(paths.directory).root, paths.lockPath, { allowMissing: true }); }
  catch (error) { throw Object.assign(new Error('Storage access coordination path is unsafe or unknown.', { cause: error }), { code: 'ERR_REPO_CACHE_ACCESS_UNSAFE' }); }
  fs.mkdirSync(paths.leases, { recursive: true });
  const payload = createLockPayload({ scope: options.scope || 'repo-cache-access', hostname: os.hostname(),
    ...(typeof options.resourceId === 'string' ? { resourceId: options.resourceId } : {}),
    ...(options.requireSettlement === true ? { resourceSettlementVersion: 1 } : {}) });
  const file = path.join(paths.leases, `${payload.lockId}.json`);
  if (options.requireSettlement === true) {
    // Publish the fence before any resource starts. A partial/failed write is
    // unknown protected evidence; do not remove it by PID-based recovery.
    const descriptor = fs.openSync(file, 'wx');
    let primary = null, closeError = null, hasPrimary = false, closeFailed = false, sealed = false;
    try { fs.writeFileSync(descriptor, JSON.stringify(payload)); fs.fsyncSync(descriptor); sealed = true; }
    catch (error) { primary = error; hasPrimary = true; }
    finally {
      try { fs.closeSync(descriptor); }
      catch (error) { closeError = error; closeFailed = true; }
    }
    if (hasPrimary || closeFailed) throw unconfirmedResourcePublication({ file, payload, primary, closeError, hasPrimary, closeFailed, sealed });
  } else fs.writeFileSync(file, JSON.stringify(payload), { flag: 'wx' });
  const lease = { file, payload, paths, suspended: false };
  const refuse = primary => {
    if (removeLockFileSyncIfOwned(file, payload)) throw primary;
    const handle = scopedLeaseHandle(lease);
    const cleanupError = Object.assign(new Error('The newly admitted cache lease could not be removed after refusal.'), {
      code: 'ERR_REPO_CACHE_ADMISSION_RELEASE_PENDING', leaseId: payload.lockId
    });
    const failure = new AggregateError([primary, cleanupError], 'Cache admission and exact lease rollback failed.', { cause: primary });
    if (typeof primary?.code === 'string') failure.code = primary.code;
    let observe = null, originalPending = false;
    try { observe = primary?.cacheOwnershipReleased; originalPending = primary?.cacheOwnershipPending === true || typeof observe === 'function'; }
    catch { originalPending = true; }
    failure.cacheOwnershipPending = true;
    failure.cacheOwnershipReleased = () => {
      if (!handle.released) return false;
      try { return !originalPending || typeof observe === 'function' && observe.call(primary) === true; } catch { return false; }
    };
    Object.defineProperty(failure, 'repoCacheAccessLease', { value: handle });
    failedAdmissions.set(failure, handle);
    throw failure;
  };
  // A collector creates its exclusion lock BEFORE inspecting leases. Therefore
  // either it observes our lease, or we observe its lock before touching data.
  if (fs.existsSync(paths.lockPath)) {
    const owner = readLockInfoSync(paths.lockPath);
    // Recheck before stale-parent recovery, not only before collection. A
    // delegated child outlives the parent's PID and must keep readers fenced.
    try { assertNoRepoCacheDelegation(paths); }
    catch (error) { refuse(error); }
    if (isKnownRepoAccessOwner(owner) && isLocalProcessDefinitelyDead(owner.pid)) {
      removeLockFileSyncIfOwned(paths.lockPath, owner);
    }
  }
  if (fs.existsSync(paths.lockPath)) {
    refuse(Object.assign(new Error('Repository cache cleanup is in progress; retry after cleanup completes.'), {
      code: 'ERR_REPO_CACHE_CLEANUP_BUSY'
    }));
  }
  try { assertNoRepoCacheDelegation(paths); }
  catch (error) { refuse(error); }
  installExitHook();
  return lease;
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
  return scopedLeaseHandle(lease);
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
