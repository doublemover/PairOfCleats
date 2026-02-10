#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireFileLock, readLockInfo } from '../../../src/shared/locks/file-lock.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'file-lock-contract');
const lockPath = path.join(tempRoot, 'contract.lock');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const lock = await acquireFileLock({ lockPath });
assert.ok(lock, 'expected lock to be acquired');
const ownedInfo = await readLockInfo(lockPath);
assert.equal(Number(ownedInfo?.pid), process.pid);
assert.ok(await lock.release(), 'expected lock release to succeed');
assert.equal(fs.existsSync(lockPath), false);

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
  'utf8'
);
const deadPidLock = await acquireFileLock({ lockPath, staleMs: 24 * 60 * 60 * 1000 });
assert.ok(deadPidLock, 'expected dead-pid lock to be replaced');
await deadPidLock.release();

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  'utf8'
);
const activeLock = await acquireFileLock({ lockPath, waitMs: 50, pollMs: 10 });
assert.equal(activeLock, null, 'expected active lock acquisition to return null');

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
console.log('file-lock contract ok.');
