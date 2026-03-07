#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyImportResolutionCacheFileSetDiffInvalidation } from '../../../src/index/build/import-resolution-cache.js';

const cache = {
  cacheKey: 'cache-key-before-diff',
  fileSetFingerprint: 'fingerprint-before-diff',
  lookup: {
    fileSet: ['src/legacy.js']
  },
  files: {
    'src/legacy.js': {
      specs: Object.create(null)
    }
  }
};

const stats = {
  invalidationReasons: Object.create(null)
};

const outcome = applyImportResolutionCacheFileSetDiffInvalidation({
  cache,
  entries: [{ rel: 'src/current.js' }],
  cacheStats: stats
});

assert.equal(outcome?.fileSetChanged, true, 'expected file-set diff to be detected');
assert.equal(outcome?.removed, 1, 'expected previous file-set entry to be removed');
assert.equal(cache.cacheKey, 'cache-key-before-diff', 'expected cache key to remain available for downstream drift checks');
assert.equal(cache.lookup, null, 'expected lookup snapshot to reset after file-set diff');
assert.equal(cache.files['src/legacy.js'], undefined, 'expected stale importer cache entry to be invalidated');

console.log('import cache file-set diff cache-key preservation test passed');
