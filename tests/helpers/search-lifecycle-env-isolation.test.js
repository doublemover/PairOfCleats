#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createSearchLifecycle } from './search-lifecycle.js';
import { rmDirRecursive } from './temp.js';

const trackedKeys = [
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_TEST_CONFIG'
];

const previous = Object.fromEntries(
  trackedKeys.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined
  ])
);

let workspaceRoot = null;
try {
  process.env.PAIROFCLEATS_CACHE_ROOT = 'original-cache-root';
  process.env.PAIROFCLEATS_EMBEDDINGS = 'original-embeddings';
  process.env.PAIROFCLEATS_TEST_CONFIG = '{"keep":true}';

  const lifecycle = await createSearchLifecycle({
    root: process.cwd(),
    cacheScope: 'shared',
    cacheName: 'search-lifecycle-env-isolation'
  });
  workspaceRoot = lifecycle.workspaceRoot;

  assert.equal(
    lifecycle.env.PAIROFCLEATS_CACHE_ROOT,
    lifecycle.cacheRoot,
    'expected returned lifecycle env to target lifecycle cache root'
  );
  assert.equal(
    lifecycle.env.PAIROFCLEATS_EMBEDDINGS,
    'stub',
    'expected returned lifecycle env to apply stub embeddings'
  );

  assert.equal(
    process.env.PAIROFCLEATS_CACHE_ROOT,
    'original-cache-root',
    'createSearchLifecycle should not mutate process cache root'
  );
  assert.equal(
    process.env.PAIROFCLEATS_EMBEDDINGS,
    'original-embeddings',
    'createSearchLifecycle should not mutate process embeddings override'
  );
  assert.equal(
    process.env.PAIROFCLEATS_TEST_CONFIG,
    '{"keep":true}',
    'createSearchLifecycle should not mutate process test config'
  );

  console.log('search lifecycle env isolation test passed');
} finally {
  if (workspaceRoot) {
    await rmDirRecursive(workspaceRoot, { retries: 8, delayMs: 100, ignoreRetryableFailure: true });
  }
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
