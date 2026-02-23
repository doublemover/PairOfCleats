#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { rmDirRecursive } from './temp.js';
import { resolveTestCachePath } from './test-cache.js';

const root = process.cwd();
const missingDir = resolveTestCachePath(root, 'temp-rmdir-enoent', `missing-${Date.now()}-${process.pid}`);

const result = await rmDirRecursive(path.join(missingDir, 'nested'), {
  retries: 2,
  delayMs: 10
});

assert.equal(result, true, 'expected rmDirRecursive to treat ENOENT as successful cleanup');

console.log('temp rmDir ENOENT handling test passed');
