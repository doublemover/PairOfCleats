import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { closeRuntimeResources } from '../../../src/index/semantic/runtime/close-resources.js';
import { withRuntimeDestinationWriter } from '../../../src/index/semantic/runtime/ownership.js';
import { containsOriginalFailure } from '../../helpers/contained-read-fault.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

for (const primary of [null, undefined, false, 0, '', Object.freeze(new Error('original runtime failure'))]) {
  const firstCleanup = Object.freeze(new Error('evidence close')), secondCleanup = Object.freeze(new Error('offsets close'));
  const calls = [];
  await assert.rejects(closeRuntimeResources([{ close() { calls.push('evidence'); throw firstCleanup; } },
    { close() { calls.push('offsets'); throw secondCleanup; } }, { close() { calls.push('healthy'); } }], primary,
  { hasOperationError: true }), failure => containsOriginalFailure(failure, primary)
    && containsOriginalFailure(failure, firstCleanup) && containsOriginalFailure(failure, secondCleanup));
  assert.deepEqual(calls, ['evidence', 'offsets', 'healthy']);
}
const root = await makeTempDir('runtime-cleanup-owner-'), originalOpendir = fs.opendir;
let released = false;
const primary = Object.freeze(Object.assign(new Error('original descriptor remains pending'), {
  cacheOwnershipReleased() { assert.equal(this, primary); return released; }
}));
const secondary = Object.freeze(new Error('destination reconciliation failed'));
try {
  await assert.rejects(withRuntimeDestinationWriter({ destination: root, maxDiskWorkingSetBytes: 1024 * 1024 }, async () => {
    fs.opendir = async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(root)) throw secondary;
      return originalOpendir(...args);
    };
    throw primary;
  }), failure => {
    assert.equal(containsOriginalFailure(failure, primary), true);
    assert.equal(containsOriginalFailure(failure, secondary), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    released = true; assert.equal(failure.cacheOwnershipReleased(), true); return true;
  });
  fs.opendir = originalOpendir;
  await assert.rejects(fs.access(path.join(root, '.writer.lock')), { code: 'ENOENT' }, 'independent lock release still executes');
  const result = await withRuntimeDestinationWriter({ destination: root, maxDiskWorkingSetBytes: 1024 * 1024 }, async () => 'next owner');
  assert.equal(result, 'next owner');
} finally { fs.opendir = originalOpendir; await rmDirRecursive(root); }
console.log('Runtime resource and destination cleanup preserve falsey/frozen original failures while all independent owners finish.');
