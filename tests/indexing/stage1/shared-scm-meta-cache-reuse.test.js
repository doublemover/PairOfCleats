#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveSharedScmMetaCache } from '../../../src/index/build/indexer/steps/process-files.js';

const runtime = {
  cacheConfig: {
    gitMeta: {
      maxEntries: 2
    }
  }
};

const cache = resolveSharedScmMetaCache(runtime);
cache.set('file-a', { churn: 1 });
cache.set('file-b', { churn: 2 });
assert.equal(cache.size(), 2, 'expected two SCM cache entries');

assert.deepEqual(cache.get('file-a'), { churn: 1 }, 'expected cache hit for promoted file-a');
cache.set('file-c', { churn: 3 });

assert.equal(cache.size(), 2, 'expected SCM cache to remain bounded');
assert.equal(cache.get('file-b'), null, 'expected least-recent SCM entry to be evicted');
assert.deepEqual(cache.get('file-a'), { churn: 1 }, 'expected promoted key to remain');
assert.deepEqual(cache.get('file-c'), { churn: 3 }, 'expected newest key to remain');

const secondRef = resolveSharedScmMetaCache(runtime);
assert.equal(secondRef, cache, 'expected shared SCM cache instance to be reused per runtime');

console.log('shared scm meta cache reuse test passed');
