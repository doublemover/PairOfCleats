#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  CACHE_ROOT_LAYOUT_VERSION,
  clearCacheRoot,
  getCacheRoot,
  resolveVersionedCacheRoot
} from '../../../src/shared/cache-roots.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'cache-root-versioning');
await fsp.rm(tempRoot, { recursive: true, force: true });
await fsp.mkdir(tempRoot, { recursive: true });

const savedEnv = { ...process.env };
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value;
  }
};

try {
  const baseRoot = path.join(tempRoot, 'cache');
  const versionedRoot = resolveVersionedCacheRoot(baseRoot);
  assert.notEqual(path.resolve(baseRoot), path.resolve(versionedRoot), 'versioned root must differ from base root');
  assert.ok(
    versionedRoot.endsWith(path.join('cache', CACHE_ROOT_LAYOUT_VERSION)),
    'versioned root should append layout version suffix'
  );

  await fsp.mkdir(baseRoot, { recursive: true });
  await fsp.mkdir(versionedRoot, { recursive: true });
  const versionedSentinel = path.join(versionedRoot, 'versioned.txt');
  const legacySentinel = path.join(baseRoot, 'legacy.txt');
  await fsp.writeFile(versionedSentinel, 'versioned');
  await fsp.writeFile(legacySentinel, 'legacy');

  process.env.PAIROFCLEATS_CACHE_ROOT = baseRoot;
  const resolved = getCacheRoot();
  assert.equal(path.resolve(resolved), path.resolve(versionedRoot), 'getCacheRoot should resolve versioned root');

  clearCacheRoot({ baseRoot, includeLegacy: false });
  assert.equal(fs.existsSync(versionedSentinel), false, 'versioned root contents should be removed');
  assert.equal(fs.existsSync(legacySentinel), true, 'legacy base entries should remain when includeLegacy=false');

  clearCacheRoot({ baseRoot, includeLegacy: true });
  assert.equal(fs.existsSync(baseRoot), false, 'base root should be removed when includeLegacy=true');
} finally {
  restoreEnv();
}

console.log('cache root versioning test passed');
