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

const inspectWriters = async (root, check) => {
  check();
  const names = [];
  let started = false;
  try {
    await withStorageDirectory(path.join(root, 'locks'), async directory => {
      started = true;
      for (let count = 0; ; count++) {
        check();
        if (count === 1024) { names.push('writer-inventory-budget'); break; }
        const entry = await directory.read();
        check();
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
  authorityRoots = [cacheRoot], dryRun = false, approvedProof = null, selectedFiles = null,
  signal = null, check = () => {}, beforeMutation = () => {}, maxEntries = 10000, maxDurationMs = 10000,
  coordinationRoot = path.join(getApplicationHome(), 'state', 'storage-access') } = {}) => {
  check();
  if (approvedProof) approvedProof = { root: approvedProof.root, proof: approvedProof.proof, identity: { ...approvedProof.identity } };
  if (selectedFiles !== null) {
    if (!Array.isArray(selectedFiles) || selectedFiles.length > maxEntries || selectedFiles.some(name => typeof name !== 'string')) throw new TypeError('Bounded reviewed repository file selection required.');
    selectedFiles = [...selectedFiles];
  }
  const root = path.resolve(repoCacheRoot);
  try { await fs.lstat(root); }
  catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'repo-cleanup-root' });
    if (diagnostic.code === 'ENOENT') return { status: 'missing', root, removed: false };
    throw error;
  }
  assertSafeCacheDeletion(root, authorityRoots);
  const access = await inspectStorageAccess(root, { signal, check });
  if (access.protected) return retained(root, 'active-or-unknown-owner', { access });
  check();
  const resources = await inspectStorageAccess(root, { coordinationRoot, signal, check });
  if (resources.protected) return retained(root, 'active-or-unknown-resource', { access: resources });
  const apply = async () => {
    check();
    assertSafeCacheDeletion(root, authorityRoots);
    const writers = await inspectWriters(root, check); check();
    if (writers.length) return retained(root, 'active-or-unknown-builder', { writers });
    const proof = await inspectRepoStorageProtection({ repoCacheRoot: root, cacheRoot, expected: approvedProof,
      signal, check, maxEntries, maxDurationMs }); check();
    if (proof.protected || !proof.complete) return retained(root, 'retained-or-unqualified-category', { reasons: proof.reasons });
    if (dryRun) return { status: 'planned', root, removed: false, logicalBytes: proof.logicalBytes, proof };
    const changedWriters = await inspectWriters(root, check); check();
    if (changedWriters.length) return retained(root, 'builder-admission-changed', { writers: changedWriters });
    const result = await removeDerivedRepoCache(proof, { cacheRoot, selectedFiles, signal, check, beforeMutation, maxEntries, maxDurationMs });
    return { ...result, status: result.ok ? selectedFiles ? 'pruned' : 'removed' : 'failed', root, removed: result.ok === true && selectedFiles === null };
  };
  if (dryRun) return apply();
  const exclusion = await withRepoCleanupExclusion({ repoCacheRoot: root, cacheRoot, action: apply, coordinationRoot });
  return exclusion.protected ? retained(root, exclusion.reason, { owners: exclusion.owners }) : exclusion.result;
};
