import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { classifyStorageRootFailure, inspectStorageRootFailure } from '../../../src/shared/storage/root-availability.js';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';

const temporary = await makeTempDir('poc-storage-offline-accounting-');
try {
  const missing = path.join(temporary, 'not-created', 'cache');
  const before = await fs.readdir(temporary);
  const absent = Object.assign(new Error('Absent registered path'), { code: 'ENOENT' });
  const offline = classifyStorageRootFailure(absent, { path: path.parse(missing).root, status: 'unavailable-or-offline',
    error: { code: 'ENOENT', message: 'drive/share is unavailable' } });
  assert.equal(offline.status, 'unavailable-or-offline');
  assert.equal(offline.complete, false, 'disconnected share ENOENT never becomes complete zero-byte inventory');
  assert.equal(classifyStorageRootFailure(absent).complete, false, 'unknown transport cannot prove absence');
  const denied = classifyStorageRootFailure(Object.assign(new Error('Denied'), { code: 'EACCES' }), { status: 'observed-directory' });
  assert.equal(denied.complete, false, 'available volume never turns permission denial into absence');
  const originalLstat = fs.lstat;
  let unavailable;
  try {
    fs.lstat = async (target, options) => {
      if ([missing, path.parse(missing).root].includes(path.resolve(target))) throw absent;
      return originalLstat(target, options);
    };
    unavailable = await inspectStorageInventory({ roots: [{ id: 'offline-category', category: 'cache', path: missing }] });
  } finally { fs.lstat = originalLstat; }
  assert.equal(unavailable.complete, false);
  assert.equal(unavailable.items[0].status, 'unavailable-or-offline');
  assert.equal(unavailable.items[0].logicalBytes, null, 'actual inventory must retain unknown bytes for offline ENOENT');
  assert.equal(unavailable.totals.uniqueLogicalBytes, null);
  assert.equal(unavailable.totals.logicalAttributedBytes, null);
  const observed = await inspectStorageRootFailure(missing, absent);
  assert.equal(observed.status, 'missing');
  assert.equal(observed.absenceObserved, true);
  const inventory = await inspectStorageInventory({ roots: [{ id: 'missing-owned-root', category: 'cache', path: missing }] });
  assert.equal(inventory.items[0].status, 'missing');
  assert.equal(inventory.items[0].volume.status, 'observed-directory');
  assert.equal(inventory.items[0].logicalBytes, 0);
  assert.deepEqual(await fs.readdir(temporary), before, 'volume observation never creates the missing root');
} finally { await rmDirRecursive(temporary); }
console.log('storage missing versus offline accounting passed');
