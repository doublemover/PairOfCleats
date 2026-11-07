import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertSafeCacheDeletion } from '../cache-deletion.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { removeToolingCacheEntry } from '../../index/tooling/cache-storage.js';
import { isOwnedCommandProbeCacheEntry } from '../../index/tooling/command-probe-persistent-cache.js';
import { inspectStorageInventory, sameStorageFileIdentity, storageFileIdentity, storageAllocatedBytes } from './inventory.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from './access.js';
import { decideStorageLifecycle, planStorageQuota } from './policy.js';
import { captureStorageAuthority, revalidateStorageAuthority } from './authority.js';
import { describeStorageFailure } from './failure-observation.js';
import { STORAGE_CLEANUP_PLAN_VERSION, LIFECYCLE_CLEANUP_PLAN_VERSION, assertStorageCleanupLimits } from '../../contracts/schemas/storage-cleanup.js';
import { createStorageInspectionAdmission } from './inspection-admission.js';
import { readStoragePolicy } from './probe-policy-read.js';
import { inspectStorageFreeSpace } from './destination.js';
import { isPathWithinRoot } from '../file-paths.js';

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
const planProbeCleanup = async ({ cacheRoot, authorityRoots = [], maxEntries = 10000,
  maxDurationMs = 10000, signal = null } = {}, originalInventory = null, originalControl = null) => {
  const limits = assertStorageCleanupLimits({ maxEntries, maxDurationMs }), control = originalControl ?? createStorageInspectionAdmission(maxDurationMs, signal);
  const root = path.resolve(cacheRoot);
  let inventory = null, authorityError = null, authoritySnapshots = [];
  let lease = { complete: false, protected: true, owners: [], coverage: 'not-inspected' };
  const operations = [], blocked = [];
  try {
    control.check();
    inventory = originalInventory ?? await inspectStorageInventory({ roots: [{ id: 'command-probes', category: 'command-probes',
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

export const planCacheRootCleanup = options => planProbeCleanup(options);

/** Launch-owned roots are supplied again; serialized plans cannot grant authority. */
const applyProbeCleanup = async (plan, { authorityRoots = [], approvedPlanId, signal = null } = {}, originalControl = null) => {
  const { planId, dryRun, ...body } = plan || {};
  void dryRun;
  if (plan?.kind !== 'pairofcleats-storage-cleanup-plan' || plan.schemaVersion !== STORAGE_CLEANUP_PLAN_VERSION
    || !Array.isArray(plan.operations) || plan.operations.length > 100000
    || !plan.complete || !plan.applyReady || planId !== digest(body) || approvedPlanId !== planId) {
    throw Object.assign(new Error('Cleanup requires the exact complete reviewed plan.'), { code: 'ERR_STORAGE_CLEANUP_PLAN' });
  }
  assertStorageCleanupLimits(plan.limits);
  if (plan.operations.length > plan.limits.maxEntries || plan.stopReason !== null) throw new Error('Cleanup plan is incomplete or exceeds its reviewed limits.');
  const control = originalControl ?? createStorageInspectionAdmission(plan.limits.maxDurationMs, signal), checks = { check: control.check, signal };
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
        return { deleted, logicalBytes: qualified.identity.size,
          allocatedBytes: storageAllocatedBytes(qualified.stat) };
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

export const applyStorageCleanupPlan = (plan, options) => applyProbeCleanup(plan, options);

const nativePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const lifecycleScope = (layout, extraRoots = []) => {
  if (!path.isAbsolute(layout?.home?.path || '') || path.parse(layout.home.path).root === path.resolve(layout.home.path)
    || !layout?.descriptors || Object.keys(layout.descriptors).length > 1023) {
    throw new TypeError('Lifecycle cleanup requires the launch-selected storage layout.');
  }
  if (!Array.isArray(extraRoots) || extraRoots.length + Object.keys(layout.descriptors).length > 1023) throw new TypeError('Lifecycle roots exceed their bounded launch selections.');
  const roots = [{ id: 'application-home', category: 'unregistered-home-data', path: layout.home.path, retention: 'mixed' },
    ...Object.entries(layout.descriptors).map(([category, entry]) => ({ ...entry, id: category, category })), ...extraRoots].map(entry => {
    const { id, category } = entry;
    if (typeof id !== 'string' || !id || typeof category !== 'string' || !category) throw new TypeError('Lifecycle roots require explicit category identities.');
    if (!path.isAbsolute(entry.path || '')) throw new TypeError('Lifecycle roots must be absolute launch selections.');
    return { id, category, path: path.resolve(entry.path), retention: entry.retention || 'unknown', external: entry.external === true };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(roots.map(root => root.id)).size !== roots.length) throw new TypeError('Lifecycle root identities must be unique.');
  const cacheRoot = roots.find(root => root.category === 'cache')?.path;
  if (!cacheRoot) throw new TypeError('Lifecycle cleanup requires the exact selected cache root.');
  return { home: path.resolve(layout.home.path), cacheRoot, roots };
};
const remainingDuration = (limits, control) => {
  control.check(); return Math.max(1, limits.maxDurationMs - (Date.now() - control.started));
};

/** One physical inventory supplies both quota attribution and the original
 * probe planner. Unknown categories stay protected; root names cannot adopt
 * their children. No serialized inventory enters this private composition. */
const observeLifecycleQuota = async (scope, limits, control, signal) => {
  control.check();
  const policy = readStoragePolicy(scope.home, { category: 'lifecycle', check: control.check });
  control.check();
  if (policy.status === 'invalid' || policy.policy.enabled !== true) return { policy, inventory: null, probePlan: null, quota: null,
    blocked: [{ reason: policy.status === 'invalid' ? 'invalid-lifecycle-policy' : 'lifecycle-policy-disabled' }] };
  const inventory = await inspectStorageInventory({ roots: scope.roots, includeFiles: true, maxEntries: limits.maxEntries,
    maxDurationMs: remainingDuration(limits, control), signal });
  control.check();
  const inventorySummary = { complete: inventory.complete, totals: inventory.totals, visitedEntries: inventory.visitedEntries,
    stopReason: inventory.stopReason, errors: inventory.errors };
  if (!inventory.complete || !Number.isSafeInteger(inventory.totals.uniqueAllocatedBytes)
    || !Number.isSafeInteger(inventory.totals.uniqueLogicalBytes)) return { policy, inventory: inventorySummary,
    probePlan: null, quota: null, blocked: [{ reason: inventory.stopReason || 'unknown-physical-accounting' }] };
  const probeRoot = path.join(scope.cacheRoot, PROBE_RELATIVE_ROOT), probeFiles = new Map();
  for (const file of inventory.physicalFiles) for (const filename of file.paths) {
    control.check();
    if (isPathWithinRoot(filename, probeRoot)) probeFiles.set(nativePath(filename), {
      relativePath: path.relative(probeRoot, filename), identity: file.identity, allocatedBytes: file.allocatedBytes });
  }
  const probeInventory = { ...inventory, items: [{ files: [...probeFiles.values()] }] };
  const probePlan = await planProbeCleanup({ cacheRoot: scope.cacheRoot, authorityRoots: [scope.cacheRoot], ...limits, signal }, probeInventory, control);
  control.check();
  const qualified = new Map(probePlan.operations.map(operation => [nativePath(path.join(probeRoot, operation.relativePath)), operation]));
  const roots = scope.roots.toSorted((a, b) => b.path.length - a.path.length);
  const items = [];
  for (const file of inventory.physicalFiles) {
    const seen = new Set();
    for (const filename of file.paths) {
      control.check();
      const key = nativePath(filename); if (seen.has(key)) continue; seen.add(key);
      const owner = roots.find(root => isPathWithinRoot(filename, root.path));
      const operation = qualified.get(key);
      const knownProbe = Boolean(operation && sameStorageFileIdentity(operation.identity, file.identity));
      items.push({ physicalIdentity: `${file.identity.dev}:${file.identity.ino}`, allocatedBytes: file.allocatedBytes,
        allocationScopeId: String(file.identity.dev), complete: inventory.complete,
        category: owner?.category, repoId: owner?.category === 'repos' ? undefined : null,
        retention: knownProbe ? 'derived' : owner?.retention || 'unknown',
        external: owner?.external === true || !isPathWithinRoot(filename, scope.home), ownerQualified: knownProbe,
        lease: knownProbe ? probePlan.lease : { complete: false, protected: true },
        references: { complete: knownProbe, retained: !knownProbe }, allLinksAccounted: file.nlink === 1,
        lastUse: { timestamp: null, provenance: 'unknown-no-original-use-observation' } });
    }
  }
  let freeSpace = null, freeSpaceScopeId = null;
  if ((policy.policy.global.minimumFreeBytes ?? 0) > 0) {
    control.check(); freeSpace = await inspectStorageFreeSpace({ destination: scope.cacheRoot }); control.check();
    if (freeSpace.complete && isPathWithinRoot(scope.cacheRoot, freeSpace.observedPath)) {
      const stat = await fs.lstat(freeSpace.observedPath, { bigint: true }); control.check();
      freeSpaceScopeId = String(stat.dev);
    }
  }
  const quota = planStorageQuota({ ...policy.policy.global, scopes: policy.policy.scopes, items,
    inventoryComplete: inventory.complete && Number.isSafeInteger(inventory.totals.uniqueAllocatedBytes)
      && Number.isSafeInteger(inventory.totals.uniqueLogicalBytes), now: control.started,
    freeBytes: freeSpace?.complete ? freeSpace.availableBytes : null, freeSpaceScopeId });
  control.check();
  const selected = new Set(quota.selected);
  const { planId, dryRun, ...probeBody } = probePlan; void planId; void dryRun;
  probeBody.operations = probeBody.operations.filter(operation => selected.has(`${operation.identity.dev}:${operation.identity.ino}`));
  probeBody.logicalPlannedBytes = probeBody.operations.reduce((sum, operation) => sum + operation.logicalBytes, 0);
  probeBody.estimatedReclaimBytes = probeBody.operations.every(operation => operation.allocatedBytes !== null)
    ? probeBody.operations.reduce((sum, operation) => sum + operation.allocatedBytes, 0) : null;
  return { policy, inventory: inventorySummary, quota, freeSpace,
    probePlan: { ...probeBody, planId: digest(probeBody), dryRun: true }, blocked: [] };
};

export const planLifecycleCleanup = async ({ layout, extraRoots = [], maxEntries = 100000, maxDurationMs = 10000, signal = null } = {}) => {
  const scope = lifecycleScope(layout, extraRoots), limits = assertStorageCleanupLimits({ maxEntries, maxDurationMs });
  const control = createStorageInspectionAdmission(maxDurationMs, signal);
  let observation = null;
  try { observation = await observeLifecycleQuota(scope, limits, control, signal); }
  catch (error) { if (!control.isStop(error)) throw error; }
  const body = { schemaVersion: LIFECYCLE_CLEANUP_PLAN_VERSION, kind: 'pairofcleats-lifecycle-cleanup-plan', scope, limits,
    complete: control.reason === null && observation?.inventory?.complete === true,
    applyReady: control.reason === null && (observation?.quota?.admission === 'admit'
      || observation?.quota?.quotaSatisfied === true && observation.probePlan?.applyReady === true),
    mutationPerformed: false, stopReason: control.reason ?? observation?.inventory?.stopReason ?? null, observation,
    preserved: 'all unqualified categories, durable/referenced evidence, offline assets and original pending owners' };
  const bytes = JSON.stringify(body);
  if (Buffer.byteLength(bytes) > 32 * 1024 * 1024) throw new Error('Lifecycle plan exceeds its readable receipt bound; select a smaller entry limit.');
  return { ...body, planId: digest(body), dryRun: true };
};

export const applyLifecycleCleanup = async (plan, { layout, extraRoots = [], approvedPlanId, signal = null } = {}) => {
  // The complete reviewed data snapshot is captured before any asynchronous
  // admission. Later caller mutation cannot replace policy or child operations.
  plan = structuredClone(plan);
  const { planId, dryRun, ...body } = plan || {}; void dryRun;
  if (body.kind !== 'pairofcleats-lifecycle-cleanup-plan' || body.schemaVersion !== LIFECYCLE_CLEANUP_PLAN_VERSION
    || planId !== approvedPlanId || planId !== digest(body) || !body.complete || !body.applyReady || body.stopReason !== null) {
    throw new Error('Lifecycle cleanup requires its exact complete reviewed plan.');
  }
  const scope = lifecycleScope(layout, extraRoots), limits = assertStorageCleanupLimits(body.limits);
  if (digest(scope) !== digest(body.scope)) throw new Error('Lifecycle cleanup launch-selected roots changed after review.');
  const control = createStorageInspectionAdmission(limits.maxDurationMs, signal);
  const fresh = await observeLifecycleQuota(scope, limits, control, signal), original = body.observation;
  if (fresh.policy.sha256 !== original.policy.sha256 || fresh.policy.policyId !== original.policy.policyId
    || fresh.quota?.quotaSatisfied !== true
    || digest(fresh.quota.selected.toSorted()) !== digest(original.quota.selected.toSorted())
    || digest(fresh.probePlan.operations) !== digest(original.probePlan.operations)) {
    throw new Error('Lifecycle policy, quota selection or original cleanup inputs changed; review a fresh plan.');
  }
  if (fresh.quota.admission === 'admit' && original.quota.selected.length === 0) return {
    schemaVersion: LIFECYCLE_CLEANUP_PLAN_VERSION, planId, complete: true, mutationPerformed: false,
    stopReason: null, cleanup: null, after: fresh, actualReclaimedBytes: null, nextAction: null };
  if (fresh.probePlan?.applyReady !== true) throw new Error('Original probe cleanup owner is no longer ready; review a fresh plan.');
  const applied = await applyProbeCleanup(original.probePlan, { authorityRoots: [scope.cacheRoot],
    approvedPlanId: original.probePlan.planId, signal }, control);
  let after = null;
  try { after = await observeLifecycleQuota(scope, limits, control, signal); }
  catch (error) { if (!control.isStop(error)) throw error; }
  const complete = applied.complete && after?.policy.sha256 === original.policy.sha256 && after?.quota?.admission === 'admit';
  return { schemaVersion: LIFECYCLE_CLEANUP_PLAN_VERSION, planId, complete, mutationPerformed: applied.mutationPerformed,
    stopReason: control.reason, cleanup: applied, after, actualReclaimedBytes: null,
    nextAction: complete ? null : 'Reinspect remaining pressure and protected owners; a new reviewed plan is required for additional cleanup.' };
};
