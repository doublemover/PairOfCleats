#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeLegacyCacheRootPath,
  CACHE_ROOT_LAYOUT_VERSION,
  clearCacheRoot,
  getCacheRoot,
  getCacheTempRoot,
  resolveVersionedCacheRoot
} from '../../../src/shared/cache-roots.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'cache-root-versioning');
await fsp.rm(tempRoot, { recursive: true, force: true });
await fsp.mkdir(tempRoot, { recursive: true });

await withTemporaryEnv({
  PAIROFCLEATS_CACHE_ROOT: '',
  PAIROFCLEATS_HOME: path.join(tempRoot, 'pairofcleats-home')
}, async () => {
  const baseRoot = path.join(tempRoot, 'pairofcleats-home');
  const cacheRoot = resolveVersionedCacheRoot(baseRoot);
  assert.ok(
    cacheRoot.endsWith(path.join('pairofcleats-home', CACHE_ROOT_LAYOUT_VERSION)),
    'cache root should be a stable, non-versioned cache directory'
  );
  assert.equal(path.basename(cacheRoot), 'cache', 'cache root must not include version suffixes');
  assert.throws(
    () => normalizeLegacyCacheRootPath(path.join(baseRoot, 'cache-v1', 'bench-language')),
    { code: 'ERR_LEGACY_CACHE_ROOT_UNSUPPORTED' },
    'legacy cache-v1 segments should fail hard after cache root cutover'
  );

  await fsp.mkdir(baseRoot, { recursive: true });
  await fsp.mkdir(cacheRoot, { recursive: true });
  const legacyRoot = path.join(baseRoot, 'cache-v1');
  await fsp.mkdir(legacyRoot, { recursive: true });
  const versionedSentinel = path.join(cacheRoot, 'versioned.txt');
  const legacySentinel = path.join(baseRoot, 'legacy.txt');
  const legacyCacheSentinel = path.join(legacyRoot, 'legacy-cache.txt');
  await fsp.writeFile(versionedSentinel, 'versioned');
  await fsp.writeFile(legacySentinel, 'legacy');
  await fsp.writeFile(legacyCacheSentinel, 'legacy-cache');

  const resolved = getCacheRoot();
  assert.equal(path.resolve(resolved), path.resolve(cacheRoot), 'getCacheRoot should resolve stable cache root');
  const tempRootPath = getCacheTempRoot('sqlite-build');
  assert.equal(
    path.resolve(tempRootPath),
    path.resolve(path.join(cacheRoot, 'tmp', 'sqlite-build')),
    'cache temp root should live under stable cache/tmp namespace'
  );

  clearCacheRoot({ baseRoot, includeLegacy: false });
  assert.equal(fs.existsSync(versionedSentinel), false, 'versioned root contents should be removed');
  assert.equal(fs.existsSync(legacySentinel), true, 'legacy base entries should remain when includeLegacy=false');
  assert.equal(
    fs.existsSync(legacyCacheSentinel),
    true,
    'legacy cache root should remain untouched when includeLegacy=false'
  );

  clearCacheRoot({ baseRoot, includeLegacy: true });
  assert.equal(fs.existsSync(cacheRoot), false, 'cache root should be removed when includeLegacy=true');
  assert.equal(fs.existsSync(legacyRoot), false, 'legacy cache root should be removed when includeLegacy=true');
  assert.equal(fs.existsSync(baseRoot), true, 'base home root should remain after cache clear');
});

console.log('cache root versioning test passed');
