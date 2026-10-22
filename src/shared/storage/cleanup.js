import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertSafeCacheDeletion } from '../cache-deletion.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { removeToolingCacheEntry } from '../../index/tooling/cache-storage.js';
import { isOwnedCommandProbeCacheEntry } from '../../index/tooling/command-probe-persistent-cache.js';
import { inspectStorageInventory, sameStorageFileIdentity, storageFileIdentity } from './inventory.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from './access.js';
import { decideStorageLifecycle } from './policy.js';
import { captureStorageAuthority, revalidateStorageAuthority } from './authority.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const errorRecord = error => ({ code: error.code || 'ERR_STORAGE_CLEANUP', message: error.message });
const PROBE_NAME = /^[a-f0-9]{40}\.json$/u;
const PROBE_RELATIVE_ROOT = path.join('tooling', 'command-probes');

const qualifyProbe = async (cacheRoot, file, expectedIdentity = null) => {
  const target = path.resolve(cacheRoot, PROBE_RELATIVE_ROOT, file);
  if (!PROBE_NAME.test(file)) throw new Error('Unregistered command-probe filename.');
  assertNoSymlinkPath(path.parse(cacheRoot).root, target);
  const before = await fs.lstat(target, { bigint: true });
  const identity = storageFileIdentity(before);
  if (!before.isFile() || before.nlink !== 1n || (expectedIdentity && !sameStorageFileIdentity(identity, expectedIdentity))) {
    throw new Error('Command-probe file ownership changed or is shared.');
  }
  const { buffer, hash, stat } = await readVerifiedContainedFile(cacheRoot, target, { maxBytes: 8 * 1024 * 1024,
    expectedFileIdentity: { dev: identity.dev, ino: identity.ino } });
  const value = JSON.parse(buffer.toString('utf8'));
  if (!isOwnedCommandProbeCacheEntry(value, file)) {
    throw new Error('Command-probe complete producer/key identity is missing or has protected unknown fields.');
  }
  const after = storageFileIdentity(await fs.lstat(target, { bigint: true }));
  if (!sameStorageFileIdentity(identity, after)) throw new Error('Command-probe changed during qualification.');
  return { target, identity, hash, stat };
};

/** The first reviewed adapter deletes only ordinary, producer-marked probes. */
export const planCacheRootCleanup = async ({ cacheRoot, authorityRoots = [], maxEntries = 10000,
  maxDurationMs = 10000, signal = null } = {}) => {
  const root = path.resolve(cacheRoot);
  const inventory = await inspectStorageInventory({ roots: [{ id: 'command-probes', category: 'command-probes',
    path: path.join(root, PROBE_RELATIVE_ROOT), retention: 'derived' }], maxEntries, maxDurationMs,
    includeFiles: true, signal });
  const lease = await inspectStorageAccess(path.join(root, PROBE_RELATIVE_ROOT));
  let authorityError = null;
  let authoritySnapshots = [];
  try {
    assertSafeCacheDeletion(path.join(root, PROBE_RELATIVE_ROOT), authorityRoots);
    authoritySnapshots = await captureStorageAuthority(authorityRoots);
  }
  catch (error) { authorityError = errorRecord(error); }
  const operations = [];
  const blocked = [];
  const item = inventory.items[0];
  for (const file of item.files || []) {
    try {
      if (path.basename(file.relativePath) !== file.relativePath) throw new Error('Nested command-probe data is not registered for cleanup.');
      const qualified = await qualifyProbe(root, file.relativePath, file.identity);
      const decision = decideStorageLifecycle({ complete: inventory.complete, ownerQualified: !authorityError,
        retention: 'derived', lease, references: { complete: true, retained: false } });
      if (!decision.eligible) {
        blocked.push({ path: qualified.target, reasons: decision.reasons, authorityError });
        continue;
      }
      operations.push({ adapter: 'command-probe-v1', root, relativePath: file.relativePath,
        identity: qualified.identity, sha256: qualified.hash, logicalBytes: file.identity.size,
        allocatedBytes: file.allocatedBytes, impact: decision.impact, rollback: 'unavailable-after-unlink' });
    } catch (error) { blocked.push({ path: path.join(item.path, file.relativePath), reasons: ['unqualified-or-changed-file'], error: errorRecord(error) }); }
  }
  const body = { schemaVersion: 1, kind: 'pairofcleats-storage-cleanup-plan', cacheRoot: root,
    mutationPerformed: false,
    complete: inventory.complete, applyReady: inventory.complete && !authorityError && !lease.protected,
    authoritySnapshots, operations, blocked,
    preserved: ['repo builds/current pointers', 'snapshots', 'diffs', 'triage', 'models', 'tools',
      'embedding profiles/cache.index.delta/references', 'reports', 'logs', 'recovery', 'unregistered data'],
    inventory: { startedAt: inventory.startedAt, finishedAt: inventory.finishedAt, complete: inventory.complete,
      stopReason: inventory.stopReason, errors: inventory.errors },
    authorityError, lease,
    logicalPlannedBytes: operations.reduce((sum, operation) => sum + operation.logicalBytes, 0),
    estimatedReclaimBytes: operations.every(operation => operation.allocatedBytes !== null)
      ? operations.reduce((sum, operation) => sum + operation.allocatedBytes, 0) : null };
  return { ...body, planId: digest(body), dryRun: true };
};

/** Launch-owned roots are supplied again; serialized plans cannot grant authority. */
export const applyStorageCleanupPlan = async (plan, { authorityRoots = [], approvedPlanId, signal = null } = {}) => {
  const { planId, dryRun, ...body } = plan || {};
  void dryRun;
  if (plan?.kind !== 'pairofcleats-storage-cleanup-plan' || plan.schemaVersion !== 1
    || !plan.complete || !plan.applyReady || !Array.isArray(plan.operations) || planId !== digest(body) || approvedPlanId !== planId) {
    throw Object.assign(new Error('Cleanup requires the exact complete reviewed plan.'), { code: 'ERR_STORAGE_CLEANUP_PLAN' });
  }
  await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
  const results = [];
  for (const operation of plan.operations) {
    if (signal?.aborted) { results.push({ ...operation, status: 'skipped', reason: 'cancelled' }); continue; }
    try {
      if (operation.adapter !== 'command-probe-v1' || operation.root !== plan.cacheRoot) throw new Error('Unregistered cleanup adapter/root.');
      const target = path.join(operation.root, PROBE_RELATIVE_ROOT, operation.relativePath);
      assertSafeCacheDeletion(target, authorityRoots);
      const excluded = await withExclusiveStorageAccess(path.join(operation.root, PROBE_RELATIVE_ROOT), async () => {
        await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
        assertSafeCacheDeletion(target, authorityRoots);
        const qualified = await qualifyProbe(operation.root, operation.relativePath, operation.identity);
        if (qualified.hash !== operation.sha256) throw new Error('Cleanup preview content changed.');
        const deleted = removeToolingCacheEntry(qualified.target, qualified.stat);
        const blocks = qualified.stat.blocks;
        return { deleted, logicalBytes: qualified.identity.size,
          allocatedBytes: process.platform !== 'win32' && Number.isSafeInteger(blocks) ? blocks * 512 : null };
      });
      results.push({ path: target, status: excluded.protected ? 'skipped' : excluded.result.deleted ? 'deleted' : 'skipped',
        reason: excluded.protected ? excluded.reason : excluded.result.deleted ? null : 'identity-changed',
        logicalBytes: excluded.result?.deleted ? excluded.result.logicalBytes : 0,
        estimatedReclaimedBytes: excluded.result?.deleted ? excluded.result.allocatedBytes : 0 });
    } catch (error) { results.push({ path: operation.relativePath, status: 'failed', error: errorRecord(error) }); }
  }
  const deleted = results.filter(result => result.status === 'deleted');
  return { schemaVersion: 1, planId, results,
    mutationPerformed: deleted.length > 0,
    complete: results.every(result => result.status === 'deleted'),
    deletedLogicalBytes: deleted.reduce((sum, result) => sum + result.logicalBytes, 0),
    estimatedReclaimedBytes: deleted.every(result => result.estimatedReclaimedBytes !== null)
      ? deleted.reduce((sum, result) => sum + result.estimatedReclaimedBytes, 0) : null,
    actualReclaimedBytes: null, measurement: 'unlink-confirmed-allocation-estimate; deleted-open-files-unknown' };
};
