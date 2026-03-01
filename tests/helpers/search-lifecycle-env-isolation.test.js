#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createSearchLifecycle } from './search-lifecycle.js';
import { withTemporaryEnv } from './test-env.js';
import { rmDirRecursive } from './temp.js';

let workspaceRoot = null;
try {
  await withTemporaryEnv({
    PAIROFCLEATS_CACHE_ROOT: 'original-cache-root',
    PAIROFCLEATS_EMBEDDINGS: 'original-embeddings',
    PAIROFCLEATS_TEST_CONFIG: '{"keep":true}'
  }, async () => {
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
  });

  console.log('search lifecycle env isolation test passed');
} finally {
  if (workspaceRoot) {
    await rmDirRecursive(workspaceRoot, { retries: 8, delayMs: 100, ignoreRetryableFailure: true });
  }
}
