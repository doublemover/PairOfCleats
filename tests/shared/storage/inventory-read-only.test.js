import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const temporary = await makeTempDir('poc-storage-inventory-');
try {
  const root = path.join(temporary, 'owned');
  const reports = path.join(root, 'reports');
  await fs.mkdir(reports, { recursive: true });
  await fs.writeFile(path.join(reports, 'saved.txt'), 'saved evidence');
  const before = await fs.readdir(temporary, { recursive: true });
  const missing = path.join(temporary, 'uncreated');
  const access = await inspectStorageAccess(missing);
  assert.equal(access.protected, false);
  const inventory = await inspectStorageInventory({ roots: [
    { id: 'parent', category: 'reports', path: root, retention: 'evidence' },
    { id: 'overlap', category: 'reports', path: reports, retention: 'evidence' },
    { id: 'missing', category: 'state', path: missing, retention: 'durable' }
  ], includeFiles: true });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.totals.logicalAttributedBytes, 28);
  assert.equal(inventory.totals.uniqueLogicalBytes, 14, 'overlapping roots count physical content once');
  assert.equal(inventory.items[2].status, 'missing');
  assert.equal(inventory.items[0].ownership.status, 'unmarked');
  assert.equal(inventory.totals.reclaimableBytes, null, 'saved evidence is never assumed reclaimable');
  assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before, 'inspection cannot create leases, roots or markers');
  const bounded = await inspectStorageInventory({ roots: [{ id: 'limited', path: root }], maxEntries: 1 });
  assert.equal(bounded.complete, false);
  assert.equal(bounded.stopReason, 'entry-budget');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await inspectStorageInventory({ roots: [{ id: 'cancelled', path: root }], signal: controller.signal });
  assert.equal(cancelled.complete, false);
  assert.equal(cancelled.stopReason, 'cancelled');
} finally { await rmDirRecursive(temporary); }
console.log('storage inventory read-only passed');
