#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveFileTextCacheForMode } from '../../../src/index/build/indexer/pipeline.js';

const runtime = {
  cacheConfig: {
    fileText: {
      maxMb: 1,
      ttlMs: 60_000
    }
  }
};

const proseCache = resolveFileTextCacheForMode({
  runtime,
  mode: 'prose',
  cacheReporter: null
});
proseCache.set('docs/readme.md', { text: 'hello' });

const extractedProseCache = resolveFileTextCacheForMode({
  runtime,
  mode: 'extracted-prose',
  cacheReporter: null
});
assert.equal(
  extractedProseCache,
  proseCache,
  'expected prose/extracted-prose to share one file text cache instance'
);
assert.equal(
  extractedProseCache.get('docs/readme.md')?.text,
  'hello',
  'expected extracted-prose mode to observe prose cache writes'
);

const codeCache = resolveFileTextCacheForMode({
  runtime,
  mode: 'code',
  cacheReporter: null
});
assert.notEqual(
  codeCache,
  proseCache,
  'expected code mode to keep an independent file text cache'
);

console.log('shared prose/extracted-prose file text cache test passed');
