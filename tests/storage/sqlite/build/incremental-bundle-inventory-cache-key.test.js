#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import {
  countMissingBundleFiles,
  listIncrementalBundleFiles
} from '../../../../src/storage/sqlite/build/runner/incremental.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-build-incremental-bundle-inventory-cache-key');
const bundleDir = path.join(tempRoot, 'bundles');
const bundleAPath = path.join(bundleDir, 'bundle-a.json');
const bundleBPath = path.join(bundleDir, 'bundle-b.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });
await fsPromises.writeFile(bundleAPath, '{"bundle":"a"}\n');

const originalStatSync = fs.statSync;
const resolvedBundleDir = path.resolve(bundleDir);
const frozenBundleDirStat = {
  mtimeMs: 1700000000000,
  size: 4096
};

fs.statSync = (targetPath, ...rest) => {
  if (typeof targetPath === 'string' && path.resolve(targetPath) === resolvedBundleDir) {
    return frozenBundleDirStat;
  }
  return originalStatSync(targetPath, ...rest);
};

try {
  const firstInventory = listIncrementalBundleFiles(bundleDir);
  assert.equal(firstInventory.count, 1, 'expected initial bundle inventory to include one file');
  assert.equal(firstInventory.names.has('bundle-a.json'), true, 'expected initial bundle inventory to include bundle-a');

  await fsPromises.rm(bundleAPath, { force: true });
  await fsPromises.writeFile(bundleBPath, '{"bundle":"b"}\n');

  const secondInventory = listIncrementalBundleFiles(bundleDir);
  assert.equal(secondInventory.count, 1, 'expected refreshed bundle inventory to include one file');
  assert.equal(secondInventory.names.has('bundle-b.json'), true, 'expected refreshed bundle inventory to include bundle-b');
  assert.equal(secondInventory.names.has('bundle-a.json'), false, 'expected stale bundle-a entry to be invalidated');

  const missingBundleCount = countMissingBundleFiles({
    bundleDir,
    manifest: {
      files: {
        'src/main.js': { bundle: 'bundle-b.json' }
      }
    }
  }, secondInventory.names);
  assert.equal(missingBundleCount, 0, 'expected refreshed inventory to prevent false missing-bundle detection');
} finally {
  fs.statSync = originalStatSync;
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite incremental bundle inventory cache key test passed');
