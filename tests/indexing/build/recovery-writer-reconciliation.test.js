#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireIndexLock, readIndexLockInfo } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { settleBuildRecoveryWriter } from '../../../src/integrations/core/build-index/recovery-context.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-recovery-writer-'));
let retained = null, childSettled = false;
try {
  const lock = await acquireIndexLock({ repoCacheRoot: directory, requireSettlement: true });
  const lease = createIndexCacheLease(lock, directory);
  const child = Object.assign(new Error('original recovered child remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => childSettled
  });
  await assert.rejects(settleBuildRecoveryWriter({ lease, lock, operationError: child }), error => {
    retained = error;
    return typeof error.releaseRecoveryWriter === 'function';
  });
  assert.ok(await readIndexLockInfo(directory));
  child.cacheOwnershipPending = false;
  child.cacheOwnershipReleased = () => true;
  await assert.rejects(retained.releaseRecoveryWriter());
  assert.equal(retained.cacheOwnershipReleased(), false, 'diagnostic mutation cannot release the original writer');
  childSettled = true;
  assert.equal(retained.cacheOwnershipReleased(), false, 'child settlement alone does not prove writer release');
  assert.equal(await retained.releaseRecoveryWriter(), true);
  assert.equal(await retained.releaseRecoveryWriter(), true);
  assert.equal(retained.cacheOwnershipReleased(), true);
  assert.equal(await readIndexLockInfo(directory), null);
  assert.throws(() => lease.assertOwned(), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });
  retained = null;
} finally {
  childSettled = true;
  if (retained) await retained.releaseRecoveryWriter();
  await fs.rm(directory, { recursive: true, force: true });
}
console.log('reviewed recovery retains exact original child and writer owners for explicit reconciliation');
