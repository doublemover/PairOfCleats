#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock, attachIndexLockSignalCleanup } from '../../../src/index/build/lock.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'index-lock-signal-cleanup');
const repoCacheRoot = path.join(outDir, 'repo-cache');
const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');

await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoCacheRoot, 'locks'), { recursive: true });

const beforeSigterm = process.listenerCount('SIGTERM');
const beforeSigint = process.listenerCount('SIGINT');
const beforeSigbreak = process.platform === 'win32' ? process.listenerCount('SIGBREAK') : 0;

const lock = await acquireIndexLock({ repoCacheRoot, waitMs: 0, log: () => {} });
assert.ok(lock, 'expected index lock acquisition to succeed');

const detach = attachIndexLockSignalCleanup(lock);
try {
  assert.equal(fs.existsSync(lockPath), true, 'expected lock file to exist after acquire');
  process.emit('SIGTERM', 'SIGTERM');
  assert.equal(fs.existsSync(lockPath), false, 'expected signal cleanup to remove owned lock file');
} finally {
  detach();
  await lock.release();
}

assert.equal(process.listenerCount('SIGTERM'), beforeSigterm, 'expected SIGTERM listener count restored');
assert.equal(process.listenerCount('SIGINT'), beforeSigint, 'expected SIGINT listener count restored');
if (process.platform === 'win32') {
  assert.equal(process.listenerCount('SIGBREAK'), beforeSigbreak, 'expected SIGBREAK listener count restored');
}

console.log('index lock signal cleanup test passed');
