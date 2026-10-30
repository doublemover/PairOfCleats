import path from 'node:path';
import { repoAccessPaths, retainRepoCacheAccess, withExclusiveRepoCacheCleanup } from '../cache/repo-access.js';
import { isLocalProcessDefinitelyDead } from '../locks/file-lock-info.js';
import { readVerifiedContainedFile } from '../contained-file.js';
import { inspectRepoCacheDelegation } from '../cache/repo-access-delegation-guard.js';
import { isKnownRepoAccessOwner, isKnownRepoResourceOwner } from '../cache/repo-access-owner.js';
import { withStorageDirectory } from './directory.js';
import { describeStorageFailure } from './failure-observation.js';

/** Use the existing admission/exclusion handshake for adopted assets as well. */
export const retainStorageAssetAccess = (root, options = {}) => retainRepoCacheAccess(root, options);
export const withExclusiveStorageAccess = (root, action, options = {}) => withExclusiveRepoCacheCleanup(root, action, options);

/** Diagnosis must not reap stale leases or create a lease directory. */
export const inspectStorageAccess = async (root, options = {}) => {
  const paths = repoAccessPaths(root, options);
  const owners = [];
  const delegation = inspectRepoCacheDelegation(paths);
  if (delegation.protected) owners.push({ role: 'delegated-exclusive-owner', protected: true, reason: delegation.reason,
    path: delegation.file, status: delegation.value ? 'owner-settlement-required' : 'unknown-owner' });
  let complete = true;
  const readOwner = async file => {
    try {
      const { buffer } = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 64 * 1024 });
      const value = JSON.parse(buffer.toString('utf8'));
      const resource = file !== paths.lockPath && isKnownRepoResourceOwner(value)
        && path.basename(file) === `${value.lockId}.json`;
      if (resource) return { path: file, pid: value.pid, lockId: value.lockId, resourceId: value.resourceId,
        status: 'resource-settlement-unconfirmed', protected: true };
      const valid = isKnownRepoAccessOwner(value)
        && (file === paths.lockPath || path.basename(file) === `${value.lockId}.json`);
      const dead = Boolean(valid && isLocalProcessDefinitelyDead(value.pid));
      return { path: file, pid: value?.pid ?? null, lockId: value?.lockId ?? null,
        status: !valid ? 'unknown-owner' : dead ? 'dead-local-owner' : 'live-or-unknown-or-pid-reused',
        protected: !dead };
    } catch (error) {
      const diagnostic = describeStorageFailure(error, { phase: 'storage-access-owner-read', defaultCode: 'ERR_STORAGE_LEASE' });
      if (diagnostic.code === 'ENOENT') return null;
      complete = false;
      return { path: file, status: 'unreadable-owner', protected: true, code: diagnostic.code };
    }
  };
  const cleanup = await readOwner(paths.lockPath);
  if (cleanup) owners.push({ ...cleanup, role: 'cleanup' });
  let enumerationStarted = false;
  try {
    await withStorageDirectory(paths.leases, async directory => {
      enumerationStarted = true;
      for (let count = 0; ; count += 1) {
        if (count >= 10000) { complete = false; owners.push({ status: 'lease-inventory-budget', protected: true }); break; }
        const entry = await directory.read();
        if (!entry) break;
        const owner = await readOwner(path.join(paths.leases, entry.name));
        if (owner) owners.push({ ...owner, role: 'reader-or-writer' });
      }
    });
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'storage-access-leases', defaultCode: 'ERR_STORAGE_LEASE' });
    if (enumerationStarted || diagnostic.code !== 'ENOENT') {
      complete = false; owners.push({ status: 'unreadable-leases', protected: true, code: diagnostic.code });
    }
  }
  return { complete, protected: !complete || owners.some(owner => owner.protected), owners,
    coverage: 'existing-repo-access-protocol-only',
    limitation: 'Unadopted model/download/install sessions require a category adapter and stay report-only.' };
};
