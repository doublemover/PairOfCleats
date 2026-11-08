import path from 'node:path';
import { CACHE_OWNER_FILE } from '../cache-deletion.js';
import { cleanupDerivedRepoArtifacts } from './repo-cleanup.js';
import { sameStorageFileIdentity } from './inventory.js';

const canonicalRepoId = /^[a-z0-9][a-z0-9-]{0,23}-[a-f0-9]{12}$/u;
const nativePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Qualification belongs to the original repository cleanup owner. The single
 * application inventory still owns physical accounting; category checks read
 * producer/reachability evidence and must match that original file set exactly.
 * No parent-directory classification or recursive removal is introduced. */
export const observeLifecycleRepositories = async ({ inventory, scope, limits, control, signal }) => {
  const repositories = new Map(), eligible = new Map(), repositoryIds = new Map(), blocked = [];
  const parent = path.join(scope.cacheRoot, 'repos');
  for (const physical of inventory.physicalFiles) for (const filename of physical.paths) {
    control.check();
    const relative = path.relative(parent, filename), parts = relative.split(path.sep);
    if (parts.length < 2 || !canonicalRepoId.test(parts[0])) continue;
    repositoryIds.set(nativePath(filename), parts[0]);
    const root = path.join(parent, parts[0]);
    if (!repositories.has(root)) {
      if (repositories.size === 128) { blocked.push({ root, reason: 'repository-owner-count-bound' }); continue; }
      repositories.set(root, { root, repoId: parts[0], files: new Map() });
    }
    repositories.get(root).files.set(nativePath(filename), physical);
  }
  const owners = [];
  for (const candidate of repositories.values()) {
    control.check();
    const inspected = await cleanupDerivedRepoArtifacts({ repoCacheRoot: candidate.root, cacheRoot: scope.cacheRoot, dryRun: true,
      coordinationRoot: scope.coordinationRoot, maxEntries: limits.maxEntries,
      maxDurationMs: Math.max(1, limits.maxDurationMs - (Date.now() - control.started)), signal, check: control.check });
    control.check();
    const proof = inspected.proof;
    if (inspected.status !== 'planned' || proof?.protected || proof?.complete !== true) {
      blocked.push({ root: candidate.root, reason: inspected.reason || inspected.status, reasons: inspected.reasons ?? [] }); continue;
    }
    if (proof.files.length !== candidate.files.size || proof.files.some(file => {
      control.check();
      const original = candidate.files.get(nativePath(path.join(candidate.root, file.relativePath)));
      return !original || !sameStorageFileIdentity(original.identity, file.identity) || original.nlink !== 1;
    })) { blocked.push({ root: candidate.root, reason: 'repository-input-changed-after-physical-inventory' }); continue; }
    const owner = { root: candidate.root, repoId: candidate.repoId, proof };
    owners.push(owner);
    for (const file of proof.files) {
      control.check();
      if (file.relativePath === CACHE_OWNER_FILE) continue;
      eligible.set(nativePath(path.join(candidate.root, file.relativePath)), { owner, file });
    }
  }
  return { owners, eligible, repositoryIds, blocked };
};

export const applyLifecycleRepositories = async (plans, { scope, limits, control, signal, beforeMutation }) => {
  const results = [];
  try {
    for (const plan of plans) {
      control.check();
      beforeMutation();
      const result = await cleanupDerivedRepoArtifacts({ repoCacheRoot: plan.root, cacheRoot: scope.cacheRoot,
        coordinationRoot: scope.coordinationRoot, approvedProof: plan.proof, selectedFiles: plan.selectedFiles,
        maxEntries: limits.maxEntries, maxDurationMs: Math.max(1, limits.maxDurationMs - (Date.now() - control.started)),
        signal, check: control.check, beforeMutation });
      results.push(result); control.check();
      if (result.ok !== true) break;
    }
  } catch (error) { if (!control.isStop(error)) throw error; }
  return { results, complete: results.length === plans.length && results.every(result => result.ok === true),
    mutationPerformed: results.some(result => result.deletedFiles?.length > 0),
    deletedLogicalBytes: results.reduce((sum, result) => sum + (result.deletedLogicalBytes || 0), 0), actualReclaimedBytes: null };
};
