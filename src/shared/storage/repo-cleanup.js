import path from 'node:path';
import fs from 'node:fs/promises';
import { assertSafeCacheDeletion } from '../cache-deletion.js';
import { inspectStorageAccess } from './access.js';
import { withRepoCleanupExclusion } from './repo-cleanup-exclusion.js';
import { getApplicationHome } from '../cache-roots.js';
import { withStorageDirectory } from './directory.js';
import { describeStorageFailure } from './failure-observation.js';
import { inspectRepoStorageProtection, removeDerivedRepoCache } from './repo-protection.js';

const retained = (root, reason, details = {}) => ({ status: 'retained-protected', root,
  removed: false, reason, ...details });

const inspectWriters = async root => {
  const names = [];
  let started = false;
  try {
    await withStorageDirectory(path.join(root, 'locks'), async directory => {
      started = true;
      for (let count = 0; ; count++) {
        if (count === 1024) { names.push('writer-inventory-budget'); break; }
        const entry = await directory.read();
        if (!entry) break;
        names.push(entry.name);
      }
    });
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'repo-cleanup-writer-inventory' });
    if (started || diagnostic.code !== 'ENOENT') names.push('unreadable-writer-inventory');
  }
  return names;
};

/** Existing exclusion protocol plus producer/retention authority. This never
 * recursively removes an unqualified tree or removes a repos parent directory.
 */
export const cleanupDerivedRepoArtifacts = async ({ repoCacheRoot, cacheRoot,
  authorityRoots = [cacheRoot], dryRun = false } = {}) => {
  const root = path.resolve(repoCacheRoot);
  try { await fs.lstat(root); }
  catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'repo-cleanup-root' });
    if (diagnostic.code === 'ENOENT') return { status: 'missing', root, removed: false };
    throw error;
  }
  assertSafeCacheDeletion(root, authorityRoots);
  const access = await inspectStorageAccess(root);
  if (access.protected) return retained(root, 'active-or-unknown-owner', { access });
  const coordinationRoot = path.join(getApplicationHome(), 'state', 'storage-access');
  const resources = await inspectStorageAccess(root, { coordinationRoot });
  if (resources.protected) return retained(root, 'active-or-unknown-resource', { access: resources });
  const apply = async () => {
    assertSafeCacheDeletion(root, authorityRoots);
    const writers = await inspectWriters(root);
    if (writers.length) return retained(root, 'active-or-unknown-builder', { writers });
    const proof = await inspectRepoStorageProtection({ repoCacheRoot: root, cacheRoot });
    if (proof.protected || !proof.complete) return retained(root, 'retained-or-unqualified-category', { reasons: proof.reasons });
    if (dryRun) return { status: 'planned', root, removed: false, logicalBytes: proof.logicalBytes };
    const changedWriters = await inspectWriters(root);
    if (changedWriters.length) return retained(root, 'builder-admission-changed', { writers: changedWriters });
    const result = await removeDerivedRepoCache(proof, { cacheRoot });
    return { ...result, status: result.ok ? 'removed' : 'failed', root, removed: result.ok === true };
  };
  if (dryRun) return apply();
  const exclusion = await withRepoCleanupExclusion({ repoCacheRoot: root, cacheRoot, action: apply });
  return exclusion.protected ? retained(root, exclusion.reason, { owners: exclusion.owners }) : exclusion.result;
};
