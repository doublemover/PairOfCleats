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
import { describeStorageFailure } from './failure-observation.js';
import { STORAGE_CLEANUP_PLAN_VERSION, assertStorageCleanupLimits } from '../../contracts/schemas/storage-cleanup.js';
import { createStorageInspectionAdmission } from './inspection-admission.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const errorRecord = error => describeStorageFailure(error, { phase: 'storage-cleanup-report',
  defaultCode: 'ERR_STORAGE_CLEANUP' });
const PROBE_NAME = /^[a-f0-9]{40}\.json$/u;
const PROBE_RELATIVE_ROOT = path.join('tooling', 'command-probes');

const qualifyProbe = async (cacheRoot, file, expectedIdentity = null, { check = () => {}, signal = null } = {}) => {
  check();
  const target = path.resolve(cacheRoot, PROBE_RELATIVE_ROOT, file);
  if (!PROBE_NAME.test(file)) throw new Error('Unregistered command-probe filename.');
  assertNoSymlinkPath(path.parse(cacheRoot).root, target);
  check();
  const before = await fs.lstat(target, { bigint: true });
  check();
  const identity = storageFileIdentity(before);
  if (!before.isFile() || before.nlink !== 1n || (expectedIdentity && !sameStorageFileIdentity(identity, expectedIdentity))) {
    throw new Error('Command-probe file ownership changed or is shared.');
  }
  const { buffer, hash, stat } = await readVerifiedContainedFile(cacheRoot, target, { maxBytes: 8 * 1024 * 1024,
    expectedFileIdentity: { dev: identity.dev, ino: identity.ino }, signal });
  check();
  const value = JSON.parse(buffer.toString('utf8'));
  if (!isOwnedCommandProbeCacheEntry(value, file)) {
    throw new Error('Command-probe complete producer/key identity is missing or has protected unknown fields.');
  }
  const after = storageFileIdentity(await fs.lstat(target, { bigint: true }));
  check();
  if (!sameStorageFileIdentity(identity, after)) throw new Error('Command-probe changed during qualification.');
  return { target, identity, hash, stat };
};

/** The first reviewed adapter deletes only ordinary, producer-marked probes. */
export const planCacheRootCleanup = async ({ cacheRoot, authorityRoots = [], maxEntries = 10000,
  maxDurationMs = 10000, signal = null } = {}) => {
  const limits = assertStorageCleanupLimits({ maxEntries, maxDurationMs }), control = createStorageInspectionAdmission(maxDurationMs, signal);
  const root = path.resolve(cacheRoot);
  let inventory = null, authorityError = null, authoritySnapshots = [];
  let lease = { complete: false, protected: true, owners: [], coverage: 'not-inspected' };
  const operations = [], blocked = [];
  try {
    control.check();
    inventory = await inspectStorageInventory({ roots: [{ id: 'command-probes', category: 'command-probes',
      path: path.join(root, PROBE_RELATIVE_ROOT), retention: 'derived' }], maxEntries, maxDurationMs, includeFiles: true, signal });
    control.check();
    if (!inventory.complete) control.stopFor(inventory.stopReason || 'inventory-incomplete');
    lease = await inspectStorageAccess(path.join(root, PROBE_RELATIVE_ROOT), { check: control.check, signal });
    control.check();
    try {
      control.check(); assertSafeCacheDeletion(path.join(root, PROBE_RELATIVE_ROOT), authorityRoots);
      authoritySnapshots = await captureStorageAuthority(authorityRoots, { check: control.check, signal });
    } catch (error) { if (control.isStop(error)) throw error; authorityError = errorRecord(error); }
    control.check();
    const decision = decideStorageLifecycle({ complete: inventory.complete, ownerQualified: !authorityError,
      retention: 'derived', lease, references: { complete: true, retained: false } });
    if (!decision.eligible) blocked.push({ path: path.join(root, PROBE_RELATIVE_ROOT), reasons: decision.reasons, authorityError });
    else for (const file of inventory.items[0].files || []) {
      control.check();
      try {
        if (path.basename(file.relativePath) !== file.relativePath) throw new Error('Nested command-probe data is not registered for cleanup.');
        const qualified = await qualifyProbe(root, file.relativePath, file.identity, { check: control.check, signal });
        control.check();
        operations.push({ adapter: 'command-probe-v1', root, relativePath: file.relativePath,
          identity: qualified.identity, sha256: qualified.hash, logicalBytes: file.identity.size,
          allocatedBytes: file.allocatedBytes, impact: decision.impact, rollback: 'unavailable-after-unlink' });
      } catch (error) {
        if (control.isStop(error)) throw error;
        blocked.push({ path: path.join(inventory.items[0].path, file.relativePath), reasons: ['unqualified-or-changed-file'], error: errorRecord(error) });
      }
    }
    control.check();
  } catch (error) { if (!control.isStop(error)) throw error; }
  const complete = inventory?.complete === true && control.reason === null;
  const body = { schemaVersion: STORAGE_CLEANUP_PLAN_VERSION, kind: 'pairofcleats-storage-cleanup-plan', cacheRoot: root,
    mutationPerformed: false,
    complete, applyReady: complete && !authorityError && lease.complete === true && !lease.protected,
    limits, stopReason: control.reason,
    authoritySnapshots, operations, blocked,
    preserved: ['repo builds/current pointers', 'snapshots', 'diffs', 'triage', 'models', 'tools',
      'embedding profiles/cache.index.delta/references', 'reports', 'logs', 'recovery', 'unregistered data'],
    inventory: { startedAt: inventory?.startedAt ?? null, finishedAt: inventory?.finishedAt ?? null, complete: inventory?.complete === true,
      stopReason: inventory?.stopReason ?? control.reason, errors: inventory?.errors ?? [] },
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
  if (plan?.kind !== 'pairofcleats-storage-cleanup-plan' || plan.schemaVersion !== STORAGE_CLEANUP_PLAN_VERSION
    || !Array.isArray(plan.operations) || plan.operations.length > 100000
    || !plan.complete || !plan.applyReady || planId !== digest(body) || approvedPlanId !== planId) {
    throw Object.assign(new Error('Cleanup requires the exact complete reviewed plan.'), { code: 'ERR_STORAGE_CLEANUP_PLAN' });
  }
  assertStorageCleanupLimits(plan.limits);
  if (plan.operations.length > plan.limits.maxEntries || plan.stopReason !== null) throw new Error('Cleanup plan is incomplete or exceeds its reviewed limits.');
  const control = createStorageInspectionAdmission(plan.limits.maxDurationMs, signal), checks = { check: control.check, signal };
  try { control.check(); await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots, checks); control.check(); }
  catch (error) { if (!control.isStop(error)) throw error; }
  const results = [];
  for (const operation of plan.operations) {
    try {
      control.check();
      if (operation.adapter !== 'command-probe-v1' || operation.root !== plan.cacheRoot) throw new Error('Unregistered cleanup adapter/root.');
      const target = path.join(operation.root, PROBE_RELATIVE_ROOT, operation.relativePath);
      assertSafeCacheDeletion(target, authorityRoots);
      control.check();
      const excluded = await withExclusiveStorageAccess(path.join(operation.root, PROBE_RELATIVE_ROOT), async () => {
        control.check();
        await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots, checks);
        control.check();
        assertSafeCacheDeletion(target, authorityRoots);
        const qualified = await qualifyProbe(operation.root, operation.relativePath, operation.identity, checks);
        if (qualified.hash !== operation.sha256) throw new Error('Cleanup preview content changed.');
        control.check();
        const deleted = removeToolingCacheEntry(qualified.target, qualified.stat);
        const blocks = qualified.stat.blocks;
        return { deleted, logicalBytes: qualified.identity.size,
          allocatedBytes: process.platform !== 'win32' && Number.isSafeInteger(blocks) ? blocks * 512 : null };
      });
      results.push({ path: target, status: excluded.protected ? 'skipped' : excluded.result.deleted ? 'deleted' : 'skipped',
        reason: excluded.protected ? excluded.reason : excluded.result.deleted ? null : 'identity-changed',
        logicalBytes: excluded.result?.deleted ? excluded.result.logicalBytes : 0,
        estimatedReclaimedBytes: excluded.result?.deleted ? excluded.result.allocatedBytes : 0 });
    } catch (error) {
      results.push(control.isStop(error) ? { path: operation.relativePath, status: 'skipped', reason: control.reason }
        : { path: operation.relativePath, status: 'failed', error: errorRecord(error) });
    }
  }
  try { control.check(); } catch (error) { if (!control.isStop(error)) throw error; }
  const deleted = results.filter(result => result.status === 'deleted');
  return { schemaVersion: STORAGE_CLEANUP_PLAN_VERSION, planId, results, stopReason: control.reason,
    mutationPerformed: deleted.length > 0,
    complete: control.reason === null && results.every(result => result.status === 'deleted'),
    deletedLogicalBytes: deleted.reduce((sum, result) => sum + result.logicalBytes, 0),
    estimatedReclaimedBytes: deleted.every(result => result.estimatedReclaimedBytes !== null)
      ? deleted.reduce((sum, result) => sum + result.estimatedReclaimedBytes, 0) : null,
    actualReclaimedBytes: null, measurement: 'unlink-confirmed-allocation-estimate; deleted-open-files-unknown' };
};
