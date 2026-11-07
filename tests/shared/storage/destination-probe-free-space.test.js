import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { inspectStorageFreeSpace, probeStorageDestination } from '../../../src/shared/storage/destination.js';

const temporary = await makeTempDir('poc-storage-destination-');
try {
  const destination = path.join(temporary, 'assets', 'models');
  const coordinationRoot = path.join(temporary, 'state', 'access');
  const before = await fs.readdir(temporary);
  const space = await inspectStorageFreeSpace({ destination, requiredBytes: 1, minimumFreeBytes: 1 });
  assert.equal(space.mutationPerformed, false);
  assert.deepEqual(await fs.readdir(temporary), before, 'free-space observation cannot create the destination');
  if (space.complete) assert.equal(Number.isSafeInteger(space.availableBytes), true);
  else assert.equal(space.availableBytes, null, 'unsupported native accounting remains unknown');
  const boundary = await inspectStorageFreeSpace({ destination,
    requiredBytes: Number.MAX_SAFE_INTEGER, minimumFreeBytes: Number.MAX_SAFE_INTEGER });
  assert.equal(boundary.reserveSatisfied, false, 'two individually exact budgets cannot round their combined reserve into an admission');
  const missing = await probeStorageDestination({ destination, coordinationRoot, authorizedRoots: [temporary] });
  assert.equal(missing.writable, false);
  assert.equal(missing.createdDirectory, false, 'explicit probe cannot silently create a selected root');
  const probe = await probeStorageDestination({ destination, coordinationRoot, authorizedRoots: [temporary], createDirectory: true });
  assert.equal(probe.writable, true);
  assert.equal(probe.probeFileRemoved, true);
  assert.equal(probe.ownershipAdopted, false);
  assert.equal(probe.configurationChanged, false);
  assert.deepEqual(await fs.readdir(destination), [], 'only the exact probe file is unlinked');
  await assert.rejects(probeStorageDestination({ destination, coordinationRoot, authorizedRoots: [temporary], repoRoot: temporary }), /project/);
} finally { await rmDirRecursive(temporary); }
console.log('storage destination probe and native free-space accounting passed');
