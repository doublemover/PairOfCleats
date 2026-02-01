#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { acquireIndexLockWithBackoff } from '../../../src/index/build/watch.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lock-backoff-'));
const repoCacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(repoCacheRoot, { recursive: true });

const lock = await acquireIndexLock({ repoCacheRoot, waitMs: 0, pollMs: 5, log: () => {} });
const start = Date.now();
const result = await acquireIndexLockWithBackoff({
  repoCacheRoot,
  shouldExit: () => false,
  log: () => {},
  backoff: {
    baseMs: 10,
    maxMs: 25,
    maxWaitMs: 80,
    logIntervalMs: 20
  }
});
const elapsed = Date.now() - start;

assert.equal(result, null, 'expected lock acquisition to time out');
assert.ok(elapsed >= 10, `expected backoff delay, got ${elapsed}ms`);

await lock.release();

console.log('watch lock backoff test passed');
