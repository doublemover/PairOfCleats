import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { repoAccessPaths, retainRepoCacheAccess, withExclusiveRepoCacheCleanup } from '../cache/repo-access.js';
import { isProcessAlive } from '../locks/file-lock-owner.js';
import { readVerifiedContainedFile } from '../contained-file.js';

/** Use the existing admission/exclusion handshake for adopted assets as well. */
export const retainStorageAssetAccess = (root, options = {}) => retainRepoCacheAccess(root, options);
export const withExclusiveStorageAccess = (root, action, options = {}) => withExclusiveRepoCacheCleanup(root, action, options);

/** Diagnosis must not reap stale leases or create a lease directory. */
export const inspectStorageAccess = async (root, options = {}) => {
  const paths = repoAccessPaths(root, options);
  const owners = [];
  let complete = true;
  const readOwner = async file => {
    try {
      const { buffer } = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 64 * 1024 });
      const value = JSON.parse(buffer.toString('utf8'));
      const valid = value && value.hostname === os.hostname() && Number.isSafeInteger(value.pid) && value.pid > 0;
      return { path: file, pid: value?.pid ?? null, lockId: value?.lockId ?? null,
        status: !valid ? 'unknown-owner' : isProcessAlive(value.pid) ? 'live-or-pid-reused' : 'dead-local-owner',
        protected: !valid || isProcessAlive(value.pid) };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      complete = false;
      return { path: file, status: 'unreadable-owner', protected: true, code: error.code || 'ERR_STORAGE_LEASE' };
    }
  };
  const cleanup = await readOwner(paths.lockPath);
  if (cleanup) owners.push({ ...cleanup, role: 'cleanup' });
  try {
    const directory = await fs.opendir(paths.leases);
    try {
      for (let count = 0; ; count += 1) {
        if (count >= 10000) { complete = false; owners.push({ status: 'lease-inventory-budget', protected: true }); break; }
        const entry = await directory.read();
        if (!entry) break;
        const owner = await readOwner(path.join(paths.leases, entry.name));
        if (owner) owners.push({ ...owner, role: 'reader-or-writer' });
      }
    } finally { await directory.close(); }
  } catch (error) {
    if (error.code !== 'ENOENT') { complete = false; owners.push({ status: 'unreadable-leases', protected: true, code: error.code }); }
  }
  return { complete, protected: !complete || owners.some(owner => owner.protected), owners,
    coverage: 'existing-repo-access-protocol-only',
    limitation: 'Unadopted model/download/install sessions require a category adapter and stay report-only.' };
};
