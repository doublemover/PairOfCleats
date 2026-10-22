// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { resolveLegacyStorageLocations } from '../../../src/shared/storage/catalog.js';
import { diagnoseStorageLayout } from '../../../src/shared/storage/operator.js';
import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';

const temporary = await makeTempDir('storage-doctor-owner-coverage-');
const leases = [];
try {
  const home = path.join(temporary, 'home');
  const cache = path.join(home, 'cache');
  const repository = path.join(cache, 'repos', 'registered-repository');
  const layout = resolveStorageLayout({ home, env: {}, overrides: { state: path.join(temporary, 'future-state') } });
  const legacy = resolveLegacyStorageLocations({ home, cacheRoot: cache, repoRoots: [repository] });
  const coordinator = path.join(home, 'state', 'storage-access');
  const tooling = legacy.find(item => item.id === 'legacy-tooling').path;
  const dictionaries = legacy.find(item => item.id === 'legacy-dictionaries').path;
  const commandProbes = legacy.find(item => item.id === 'legacy-command-probes').path;
  for (const root of [layout.descriptors.models.path, tooling, dictionaries]) {
    leases.push(acquireRepoCacheAccessLease(root, { coordinationRoot: coordinator,
      resourceId: `fixture-${path.basename(root)}`, requireSettlement: true }));
  }
  for (const root of [repository, commandProbes]) leases.push(acquireRepoCacheAccessLease(root));
  const before = await fs.readdir(temporary, { recursive: true });
  const diagnosis = await diagnoseStorageLayout(layout, { extraRoots: legacy });
  assert.equal(diagnosis.leaseInspectionComplete, true);
  for (const root of [layout.descriptors.models.path, tooling, dictionaries, repository, commandProbes]) {
    assert.ok(diagnosis.findings.some(finding => finding.code === 'active-or-unknown-storage-owner' && finding.path === root),
      `doctor must report the exact registered owner at ${root}`);
  }
  const model = diagnosis.leaseInventory.find(item => item.path === layout.descriptors.models.path);
  assert.equal(model.coordinationRoot, coordinator, 'a state descriptor cannot silently relocate the active session coordinator');
  assert.equal(model.owners[0].status, 'resource-settlement-unconfirmed');
  const repoOwners = diagnosis.leaseInventory.filter(item => item.path === repository);
  assert.equal(repoOwners.length, 1, 'many repository class locations share one exact registered repository owner');
  assert.equal(repoOwners[0].coordinationRoot, null);
  assert.ok(repoOwners[0].registeredIds.length > 1);
  assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before, 'doctor never creates or reaps owner metadata');

  const controller = new AbortController();
  controller.abort(new Error('inert already cancelled diagnosis'));
  const cancelled = await diagnoseStorageLayout(layout, { extraRoots: legacy, signal: controller.signal });
  assert.equal(cancelled.leaseInspectionComplete, false);
  assert.equal(cancelled.leaseStopReason, 'cancelled');
  assert.deepEqual(cancelled.leaseInventory, []);
  assert.equal(cancelled.inventory.visitedEntries, 0);
  assert.equal(cancelled.inventory.items.length, Object.keys(layout.descriptors).length + legacy.length,
    'cancelled inspection keeps every registered location visible as unscanned');
  assert.ok(cancelled.inventory.items.every(item => item.status === 'unscanned' && item.logicalBytes === null));
  const bounded = await diagnoseStorageLayout(layout, { extraRoots: legacy, maxEntries: 1 });
  assert.equal(bounded.leaseInspectionComplete, false);
  assert.equal(bounded.leaseStopReason, 'registered-root-budget');
  assert.equal(bounded.leaseInventory.length, 1);
  assert.equal(bounded.inventory.visitedEntries, 1, 'metadata-only inspection honors its entry bound as well');
  assert.ok(bounded.findings.some(finding => finding.code === 'storage-owner-inspection-incomplete'));
} finally {
  for (const lease of leases.reverse()) lease.release();
  await rmDirRecursive(temporary);
}
console.log('Storage doctor diagnoses exact registered category and repository owners without mutation.');
