import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createDiscoveryDirectoryInventory, createDiscoveryDirectoryInventoryReader } from '../../../src/index/build/discovery/directory-inventory.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual data owner with synthetic enumeration rows; not a 10,000-file disk or
// latency measurement. Filesystem parity has a separate actual discovery owner.
const root = await makeTempDir('poc-directory-inventory-bounds-');
try {
  const before = await fs.lstat(root, { bigint: true }), canonicalRoot = await fs.realpath(root), metrics = {};
  const owner = createDiscoveryDirectoryInventory({ root, canonicalRoot, metrics });
  const directory = owner.beginDirectory(root, before, canonicalRoot);
  for (let index = 0; index < 10000; index++) directory.add({ name: `file-${index}.js`, kind: 'file' });
  directory.complete(await fs.lstat(root, { bigint: true }));
  const entries = [];
  owner.seal(entries);
  const reader = await createDiscoveryDirectoryInventoryReader(entries, root);
  assert.equal((await reader.read(root)).rows.length, 10000);
  assert.ok(metrics.directoryInventoryBytes <= 8 * 1024 * 1024);
  assert.equal(await createDiscoveryDirectoryInventoryReader([...entries], root), null);

  const oversizedMetrics = {}, oversized = createDiscoveryDirectoryInventory({ root, canonicalRoot, metrics: oversizedMetrics });
  const huge = oversized.beginDirectory(root, before, canonicalRoot);
  huge.add({ name: 'x'.repeat(8 * 1024 * 1024), kind: 'file' });
  huge.complete(before);
  const rejected = []; oversized.seal(rejected);
  assert.equal(await createDiscoveryDirectoryInventoryReader(rejected, root), null);
  assert.equal(oversizedMetrics.directoryInventoryBytes, 0, 'partial over-budget directory cannot retain completeness or its row buffer');

  const cancelledMetrics = {}, cancelled = createDiscoveryDirectoryInventory({ root, canonicalRoot, metrics: cancelledMetrics });
  const partial = cancelled.beginDirectory(root, before, canonicalRoot);
  partial.add({ name: 'partial.js', kind: 'file' }); partial.cancel();
  const unsealed = []; cancelled.seal(unsealed);
  assert.equal(await createDiscoveryDirectoryInventoryReader(unsealed, root), null);
  assert.equal(cancelledMetrics.directoryInventoryBytes, 0);
} finally { await rmDirRecursive(root); }
console.log('Bounded directory inventory controls authored; execution deferred.');
