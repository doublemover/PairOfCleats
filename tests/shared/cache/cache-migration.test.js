#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getCacheRoot, resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'cache-migration');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runScenario = async ({ baseName, rebuild }) => {
  const baseRoot = path.join(tempRoot, baseName);
  const resolvedRoot = resolveVersionedCacheRoot(baseRoot);
  await fs.mkdir(baseRoot, { recursive: true });
  await fs.mkdir(resolvedRoot, { recursive: true });
  const legacyPath = path.join(resolvedRoot, 'legacy.txt');
  const sentinelPath = path.join(resolvedRoot, 'sentinel.txt');
  await fs.writeFile(legacyPath, 'legacy');
  await fs.writeFile(sentinelPath, 'keep');

  process.env.PAIROFCLEATS_CACHE_ROOT = baseRoot;
  if (rebuild) {
    process.env.PAIROFCLEATS_CACHE_REBUILD = '1';
  } else {
    delete process.env.PAIROFCLEATS_CACHE_REBUILD;
  }

  const resolved = getCacheRoot();
  assert.equal(path.resolve(resolved), path.resolve(resolvedRoot), 'expected resolved cache root');

  if (rebuild) {
    assert.equal(fsSync.existsSync(legacyPath), false, 'expected rebuild to clear cache root');
    assert.equal(fsSync.existsSync(sentinelPath), false, 'expected rebuild to clear cache root');
  } else {
    assert.equal(fsSync.existsSync(legacyPath), true, 'expected cache root to remain without rebuild');
    assert.equal(fsSync.existsSync(sentinelPath), true, 'expected cache root to remain without rebuild');
  }
};

await runScenario({ baseName: 'root-a', rebuild: false });
await runScenario({ baseName: 'root-b', rebuild: true });

console.log('cache migration tests passed');
