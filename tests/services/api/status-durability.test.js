#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteText, resetAtomicWriteRuntimeMetricsForTests } from '../../../src/shared/io/atomic-write.js';
import { status } from '../../../src/integrations/core/status.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'api-status-durability');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
applyTestEnv({ cacheRoot: tempRoot });
resetAtomicWriteRuntimeMetricsForTests();

const targetPath = path.join(repoRoot, 'degraded.txt');
const originalRename = fsPromises.rename;
let exdevAttempts = 0;
let crossDeviceSource = null;
const committedSources = [];
fsPromises.rename = async (...args) => {
  const [source, nextTarget] = args;
  if (String(nextTarget || '') === targetPath && (crossDeviceSource === null || source === crossDeviceSource)) {
    crossDeviceSource = source;
    exdevAttempts += 1;
    const err = new Error('cross-device link not permitted');
    err.code = 'EXDEV';
    throw err;
  }
  if (String(nextTarget || '') === targetPath) committedSources.push(source);
  return originalRename(...args);
};
try {
  await atomicWriteText(targetPath, 'degraded-ok');
} finally {
  fsPromises.rename = originalRename;
}

assert.equal(fs.readFileSync(targetPath, 'utf8'), 'degraded-ok');
assert.ok(exdevAttempts >= 1, 'the cross-device source cannot be renamed to this volume');
assert.equal(committedSources.length, 1, 'the same-volume staged commit succeeds once');
assert.notEqual(committedSources[0], crossDeviceSource);

const payload = await status({ repoRoot });
assert.equal(payload?.durability?.runtime?.degradedDurability, true, 'expected status payload to expose degraded durability');
assert.equal(payload?.durability?.runtime?.exdevRenameFallbackCount >= 1, true, 'expected status payload to count EXDEV fallback usage');
assert.equal(typeof payload?.durability?.runtime?.lastExdevFallbackAt, 'string', 'expected status payload to expose last EXDEV fallback timestamp');

console.log('API status durability test passed');
