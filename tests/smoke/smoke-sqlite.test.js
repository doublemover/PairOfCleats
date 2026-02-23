#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const cacheSuffix = 'smoke-sqlite';
const cacheRoots = [
  resolveTestCachePath(root, 'sqlite-incremental', `file-manifest-updates-${cacheSuffix}`),
  resolveTestCachePath(root, `sqlite-ann-fallback-${cacheSuffix}`)
];

let failure = null;
try {
  await cleanup(cacheRoots);
  const env = applyTestEnv({
    extraEnv: {
      PAIROFCLEATS_TEST_CACHE_SUFFIX: cacheSuffix
    }
  });
  runNode(
    'sqlite-incremental-manifest',
    path.join(root, 'tests', 'storage', 'sqlite', 'incremental', 'file-manifest-updates.test.js'),
    [],
    { env }
  );
  runNode(
    'sqlite-ann-fallback',
    path.join(root, 'tests', 'storage', 'sqlite', 'ann', 'sqlite-ann-fallback.test.js'),
    [],
    { env }
  );
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke sqlite passed');

