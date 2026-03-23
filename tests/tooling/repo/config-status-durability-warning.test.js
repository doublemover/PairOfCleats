#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { configStatus } from '../../../tools/mcp/repo.js';
import {
  atomicWriteText,
  resetAtomicWriteRuntimeMetricsForTests
} from '../../../src/shared/io/atomic-write.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'config-status-durability-warning');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
applyTestEnv({ cacheRoot });

resetAtomicWriteRuntimeMetricsForTests();
const exdevPath = path.join(cacheRoot, 'durability.txt');
const originalRename = fsPromises.rename;
fsPromises.rename = async (...args) => {
  const [, targetPath] = args;
  if (String(targetPath || '').includes('durability.txt')) {
    const err = new Error('cross-device link not permitted');
    err.code = 'EXDEV';
    throw err;
  }
  return originalRename(...args);
};
try {
  await atomicWriteText(exdevPath, 'degraded');
} finally {
  fsPromises.rename = originalRename;
}

const originalStatSync = fs.statSync;
fs.statSync = (candidatePath, ...rest) => {
  const result = originalStatSync(candidatePath, ...rest);
  const resolved = path.resolve(String(candidatePath || ''));
  if (resolved.startsWith(path.resolve(repoRoot))) {
    Object.defineProperty(result, 'dev', { value: 101, configurable: true });
    return result;
  }
  if (resolved.startsWith(path.resolve(cacheRoot))) {
    Object.defineProperty(result, 'dev', { value: 202, configurable: true });
    return result;
  }
  return result;
};

let payload = null;
try {
  payload = await configStatus({ repoPath: repoRoot });
} finally {
  fs.statSync = originalStatSync;
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

const warningCodes = new Set((payload?.warnings || []).map((entry) => entry?.code));
assert.equal(warningCodes.has('atomic_write_exdev_fallback'), true, 'expected EXDEV fallback warning');
assert.equal(warningCodes.has('atomic_write_layout_risk'), true, 'expected layout risk warning');
assert.equal(payload?.durability?.runtime?.degradedDurability, true, 'expected degraded durability runtime flag');
assert.equal(payload?.durability?.layout?.crossDeviceRisk, true, 'expected cross-device layout risk');
assert.equal(payload?.durability?.layout?.reason, 'device_mismatch', 'expected device mismatch reason');

console.log('config status durability warning test passed');
