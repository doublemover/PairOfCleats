import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewStorageLifecycle } from '../../../src/shared/storage/lifecycle-review.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { inspectStorageLayout, diagnoseStorageLayout } from '../../../src/shared/storage/operator.js';
import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/lifecycle-operator-review/')[1];
assert.ok(['root-intent-and-unknown-accounting', 'same-inventory-overlap-and-no-mutation', 'original-owner-diagnosis-and-review-bound'].includes(mode));
if (mode === 'root-intent-and-unknown-accounting') {
  const layout = { descriptors: { models: { retention: 'downloadable', external: false }, reports: { retention: 'evidence', external: true } } };
  const inventory = { complete: false, items: [{ id: 'models', category: 'models', status: 'present-unscanned', complete: false },
    { id: 'reports', category: 'reports', status: 'unscanned', complete: false }] };
  const result = reviewStorageLifecycle({ layout, inventory });
  assert.equal(result.registeredRoots, 2); assert.equal(result.registeredRootCoverageComplete, true);
  assert.equal(result.inventoryComplete, false); assert.equal(result.accounting.uniqueAllocatedBytes, null);
  assert.equal(result.accounting.reclaimableAllocatedBytes, null); assert.equal(result.accounting.plannedDeletions, 0);
  const models = result.roots[0], reports = result.roots[1];
  assert.ok(models.classIntentIds.includes('models-onnx-sidecars')); assert.ok(models.blockers.includes('offline-critical-asset-retention'));
  assert.ok(models.blockers.includes('category-owner-not-qualified')); assert.equal(models.ownerObservationComplete, false);
  assert.ok(reports.blockers.includes('saved-or-referenced-evidence')); assert.ok(reports.blockers.includes('external-or-shared-user-storage'));
  assert.equal(result.roots.every(row => row.cleanupEligible === false), true);
  assert.equal(models.logicalAttributedBytes, null, 'registered locations cannot fabricate zero-byte usage');
} else {
  const taskRoot = fileURLToPath(new URL('../../../.tmp/tests/storage-lifecycle-review/', import.meta.url));
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  assertNoSymlinkPath(repositoryRoot, taskRoot, { allowMissing: true });
  await fs.mkdir(taskRoot, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(taskRoot, 'case-')); let lease = null;
  try {
    const home = path.join(temporary, 'home'), layout = resolveStorageLayout({ home, env: {} });
    const reports = path.join(layout.descriptors.cache.path, 'reports'); await fs.mkdir(reports, { recursive: true });
    await fs.writeFile(path.join(reports, 'saved.txt'), 'saved evidence');
    if (mode === 'same-inventory-overlap-and-no-mutation') {
      const before = await fs.readdir(temporary, { recursive: true });
      const observed = await inspectStorageLayout(layout, { exact: true, category: 'cache',
        extraRoots: [{ id: 'nested-report', category: 'cache', path: reports, retention: 'evidence' }] });
      assert.equal(observed.complete, true); assert.equal(observed.totals.logicalAttributedBytes, 28);
      assert.equal(observed.lifecycle.accounting.logicalAttributedBytes, observed.totals.logicalAttributedBytes);
      assert.equal(observed.lifecycle.accounting.uniqueLogicalBytes, 14);
      assert.equal(observed.lifecycle.accounting.uniqueAllocatedBytes, observed.totals.uniqueAllocatedBytes);
      if (process.platform === 'win32') assert.equal(observed.lifecycle.accounting.uniqueAllocatedBytes, null);
      assert.equal(observed.lifecycle.accounting.reclaimableAllocatedBytes, null);
      assert.ok(observed.lifecycle.roots.every(row => row.cleanupEligible === false));
      assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before);
    } else {
      const models = layout.descriptors.models.path; await fs.mkdir(models, { recursive: true });
      const coordinator = path.join(home, 'state', 'storage-access');
      lease = acquireRepoCacheAccessLease(models, { coordinationRoot: coordinator });
      const before = await fs.readdir(temporary, { recursive: true });
      const diagnosis = await diagnoseStorageLayout(layout), model = diagnosis.inventory.lifecycle.roots.find(row => row.id === 'models');
      assert.equal(model.ownerObservationComplete, true); assert.equal(model.activeOrUnknownOwner, true);
      assert.ok(model.blockers.includes('active-or-unknown-lease')); assert.equal(model.cleanupEligible, false);
      assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before);
      const limited = reviewStorageLifecycle({ layout, inventory: diagnosis.inventory, leaseInventory: diagnosis.leaseInventory, maxRoots: 1 });
      assert.equal(limited.registeredRootCoverageComplete, false); assert.equal(limited.roots.length, 1);
      assert.equal(limited.omittedRegisteredRoots, diagnosis.inventory.items.length - 1);
      const controller = new AbortController(); controller.abort();
      const cancelled = await diagnoseStorageLayout(layout, { signal: controller.signal });
      assert.equal(cancelled.inventory.lifecycle.registeredRoots, Object.keys(layout.descriptors).length);
      assert.ok(cancelled.inventory.lifecycle.roots.every(row => row.activeOrUnknownOwner && !row.cleanupEligible));
    }
  } finally {
    lease?.release();
    assertNoSymlinkPath(repositoryRoot, temporary);
    const actualTaskRoot = await fs.realpath(taskRoot), actualTemporary = await fs.realpath(temporary);
    assert.equal(path.dirname(actualTemporary), actualTaskRoot, 'recursive deletion stays within this exact disposable fixture root');
    await rmDirRecursive(actualTemporary, { retries: 0 });
  }
}
console.log('Storage operators expose lifecycle intent and original observations without rescan, mutation or deletion authority.');
