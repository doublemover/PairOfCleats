#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  acquireFileLock,
  getFileLockRuntimeMetrics,
  readLockInfo,
  resetFileLockRuntimeMetricsForTests
} from '../../../src/shared/locks/file-lock.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'file-lock-contract');
const lockPath = path.join(tempRoot, 'contract.lock');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
resetFileLockRuntimeMetricsForTests();

const lock = await acquireFileLock({ lockPath });
assert.ok(lock, 'expected lock to be acquired');
const ownedInfo = await readLockInfo(lockPath);
assert.equal(Number(ownedInfo?.pid), process.pid);
assert.ok(await lock.release(), 'expected lock release to succeed');
assert.equal(fs.existsSync(lockPath), false);

const reservedMetadataLock = await acquireFileLock({
  lockPath,
  metadata: {
    pid: 123,
    lockId: 'spoofed-lock-id',
    startedAt: '1970-01-01T00:00:00.000Z',
    scope: 'metadata-preserved'
  }
});
assert.ok(reservedMetadataLock, 'expected lock acquisition with metadata');
assert.equal(Number(reservedMetadataLock.payload?.pid), process.pid, 'metadata pid must not override lock owner pid');
assert.notEqual(
  String(reservedMetadataLock.payload?.lockId || ''),
  'spoofed-lock-id',
  'metadata lockId must not override generated lock id'
);
assert.notEqual(
  String(reservedMetadataLock.payload?.startedAt || ''),
  '1970-01-01T00:00:00.000Z',
  'metadata startedAt must not override generated startedAt'
);
assert.equal(reservedMetadataLock.payload?.scope, 'metadata-preserved', 'non-reserved metadata should be preserved');
const reservedMetadataInfo = await readLockInfo(lockPath);
assert.equal(Number(reservedMetadataInfo?.pid), process.pid, 'lockfile pid must remain process pid');
assert.equal(reservedMetadataInfo?.scope, 'metadata-preserved', 'expected non-reserved metadata persisted to lockfile');
await reservedMetadataLock.release();

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
  'utf8'
);
await assert.rejects(
  () => acquireFileLock({
    lockPath,
    staleMs: 24 * 60 * 60 * 1000,
    staleRemovalImpl: async () => {
      const error = new Error('mock stale lock removal denied');
      error.code = 'EACCES';
      throw error;
    }
  }),
  (error) => (
    error?.code === 'ERR_FILE_LOCK_STALE_REMOVE_FAILED'
    && error?.causeCode === 'EACCES'
    && String(error?.message || '').includes('stale lock cleanup failed')
  ),
  'expected stale lock cleanup failures to propagate with structured metadata'
);
const deadPidLock = await acquireFileLock({ lockPath, staleMs: 24 * 60 * 60 * 1000 });
assert.ok(deadPidLock, 'expected dead-pid lock to be replaced');
await deadPidLock.release();

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
  'utf8'
);
const deadPidWithThrowingStaleHook = await acquireFileLock({
  lockPath,
  staleMs: 24 * 60 * 60 * 1000,
  onStale: () => {
    throw new Error('intentional stale hook failure');
  }
});
assert.ok(
  deadPidWithThrowingStaleHook,
  'expected stale lock cleanup to proceed even when onStale hook throws'
);
await deadPidWithThrowingStaleHook.release();

await fsPromises.writeFile(lockPath, 'not-json-lock');
await fsPromises.utimes(lockPath, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
let corruptStaleEvent = null;
const corruptStaleLock = await acquireFileLock({
  lockPath,
  staleMs: 1_000,
  waitMs: 0,
  onStale: (event) => {
    corruptStaleEvent = event;
  }
});
assert.ok(corruptStaleLock, 'expected stale corrupt lock to be replaced even without owner metadata');
assert.equal(corruptStaleEvent?.removalMode, 'force', 'expected ownerless stale lock cleanup to use force mode');
await corruptStaleLock.release();

await fsPromises.writeFile(lockPath, 'not-json-lock');
const corruptFreshLock = await acquireFileLock({ lockPath, staleMs: 60_000, waitMs: 0 });
assert.equal(corruptFreshLock, null, 'expected fresh corrupt lock to remain busy until stale');
await fsPromises.rm(lockPath, { force: true });

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  'utf8'
);
const activeLock = await acquireFileLock({ lockPath, waitMs: 50, pollMs: 10 });
assert.equal(activeLock, null, 'expected active lock acquisition to return null');

const activeWithThrowingBusyHook = await acquireFileLock({
  lockPath,
  waitMs: 20,
  pollMs: 5,
  onBusy: () => {
    throw new Error('intentional busy hook failure');
  }
});
assert.equal(
  activeWithThrowingBusyHook,
  null,
  'expected busy hook failure to not change lock acquisition decision'
);

let threwTimeout = false;
try {
  await acquireFileLock({
    lockPath,
    waitMs: 50,
    pollMs: 10,
    timeoutBehavior: 'throw',
    timeoutMessage: 'Queue lock timeout.'
  });
} catch (err) {
  threwTimeout = true;
  assert.match(String(err?.message || err), /Queue lock timeout\./);
}
assert.equal(threwTimeout, true, 'expected timeoutBehavior=throw to throw');

await fsPromises.rm(lockPath, { force: true });
const heldLock = await acquireFileLock({ lockPath });
assert.ok(heldLock, 'expected held lock before abort wait test');
const lockAbortController = new AbortController();
setTimeout(() => lockAbortController.abort(new Error('abort file lock wait')), 20);
const abortStartedAt = Date.now();
await assert.rejects(
  () => acquireFileLock({
    lockPath,
    waitMs: 5000,
    pollMs: 50,
    signal: lockAbortController.signal
  }),
  (err) => err?.code === 'ABORT_ERR',
  'expected lock wait to reject with abort error when signal is aborted'
);
const abortElapsedMs = Date.now() - abortStartedAt;
assert.ok(abortElapsedMs < 2500, `expected lock wait abort to short-circuit quickly (elapsed=${abortElapsedMs}ms)`);
await heldLock.release();

const raceLockPath = path.join(tempRoot, 'race-parent', 'race.lock');
let observedParentMissingRetry = false;
for (let attempt = 0; attempt < 8 && !observedParentMissingRetry; attempt += 1) {
  let keepDeleting = true;
  const disruptor = (async () => {
    const endAt = Date.now() + 120;
    while (keepDeleting && Date.now() < endAt) {
      await fsPromises.rm(path.dirname(raceLockPath), { recursive: true, force: true }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();
  const lockWithRace = await acquireFileLock({
    lockPath: raceLockPath,
    waitMs: 1000,
    pollMs: 5
  });
  keepDeleting = false;
  await disruptor;
  assert.ok(lockWithRace, 'expected lock acquisition to survive parent directory deletion race');
  observedParentMissingRetry = Number(lockWithRace?.diagnostics?.parentMissingRetries || 0) > 0;
  await lockWithRace.release();
}
if (!observedParentMissingRetry) {
  console.warn('[file-lock-contract] parent-missing retry race did not reproduce; continuing.');
}
assert.ok(
  Number(getFileLockRuntimeMetrics().parentMissingRetries) >= 0,
  'expected runtime metrics to expose parent-missing retry counter'
);

await fsPromises.rm(lockPath, { force: true });
console.log('file-lock contract ok.');
