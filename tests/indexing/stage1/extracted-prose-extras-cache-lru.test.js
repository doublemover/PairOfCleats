#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveExtractedProseExtrasCache } from '../../../src/index/build/indexer/steps/process-files.js';

const runtime = {
  cacheConfig: {
    extractedProseExtras: {
      maxEntries: 2
    }
  }
};

const cache = resolveExtractedProseExtrasCache(runtime);
cache.set('k1', { value: 1 });
cache.set('k2', { value: 2 });
assert.equal(cache.size(), 2, 'expected two cache entries');

// Promote k1 to most-recent before inserting k3.
assert.deepEqual(cache.get('k1'), { value: 1 }, 'expected cache hit for k1');
cache.set('k3', { value: 3 });

assert.equal(cache.size(), 2, 'expected LRU cache size to remain bounded');
assert.equal(cache.get('k2'), null, 'expected least-recent entry to be evicted');
assert.deepEqual(cache.get('k1'), { value: 1 }, 'expected promoted key to stay resident');
assert.deepEqual(cache.get('k3'), { value: 3 }, 'expected newest key to stay resident');

const secondRef = resolveExtractedProseExtrasCache(runtime);
assert.equal(secondRef, cache, 'expected cache resolver to return shared instance');

console.log('extracted-prose extras cache LRU test passed');
