#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { waitForStableFile } from '../../../src/index/build/watch/stability.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-stability-checks-'));
applyTestEnv({ cacheRoot: tempRoot });

const stablePath = path.join(tempRoot, 'stable.txt');
await fs.writeFile(stablePath, 'stable');

const intervalMs = 200;
const startedAt = Date.now();
const checksOneStable = await waitForStableFile(stablePath, { checks: 1, intervalMs });
const elapsedMs = Date.now() - startedAt;
assert.equal(checksOneStable, true, 'expected checks=1 to pass for an existing file');
assert.ok(
  elapsedMs < Math.floor(intervalMs * 0.75),
  `expected checks=1 to avoid waiting a full interval (elapsed=${elapsedMs}ms)`
);

const checksThreeStable = await waitForStableFile(stablePath, { checks: 3, intervalMs: 20 });
assert.equal(checksThreeStable, true, 'expected checks>1 to pass when file remains stable');

const missingPath = path.join(tempRoot, 'missing.txt');
const missingStable = await waitForStableFile(missingPath, { checks: 1, intervalMs: 20 });
assert.equal(missingStable, false, 'expected missing files to fail stability check');

console.log('watch stability checks test passed');
