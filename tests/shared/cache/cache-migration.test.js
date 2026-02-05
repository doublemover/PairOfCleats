#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CACHE_KEY_VERSION } from '../../../src/shared/cache-key.js';
import { getCacheRoot, resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'cache-migration');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runScenario = async ({ baseName, rebuild }) => {
  const baseRoot = path.join(tempRoot, baseName);
  const versionedRoot = resolveVersionedCacheRoot(baseRoot, CACHE_KEY_VERSION);
  await fs.mkdir(baseRoot, { recursive: true });
  await fs.mkdir(versionedRoot, { recursive: true });
  await fs.writeFile(path.join(baseRoot, 'legacy.txt'), 'legacy');
  await fs.writeFile(path.join(versionedRoot, 'sentinel.txt'), 'keep');

  process.env.PAIROFCLEATS_CACHE_ROOT = baseRoot;
  if (rebuild) {
    process.env.PAIROFCLEATS_CACHE_REBUILD = '1';
  } else {
    delete process.env.PAIROFCLEATS_CACHE_REBUILD;
  }

  const resolved = getCacheRoot();
  assert.ok(resolved.endsWith(path.join(baseName, CACHE_KEY_VERSION)), 'expected versioned cache root');

  const legacyPath = path.join(baseRoot, 'legacy.txt');
  assert.equal(fsSync.existsSync(legacyPath), false, 'expected legacy cache to be purged');

  const sentinelPath = path.join(versionedRoot, 'sentinel.txt');
  if (rebuild) {
    assert.equal(fsSync.existsSync(sentinelPath), false, 'expected rebuild to clear versioned cache root');
  } else {
    assert.equal(fsSync.existsSync(sentinelPath), true, 'expected versioned cache root to remain');
  }
};

await runScenario({ baseName: 'root-a', rebuild: false });
await runScenario({ baseName: 'root-b', rebuild: true });

console.log('cache migration tests passed');
