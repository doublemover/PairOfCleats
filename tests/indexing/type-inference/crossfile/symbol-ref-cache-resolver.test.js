#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSymbolRefCacheResolver } from '../../../../src/index/type-inference-crossfile/symbol-ref-cache.js';
import { ensureTestingEnv } from '../../../helpers/test-env.js';

ensureTestingEnv(process.env);

let nowMs = 1_000;
const resolveCalls = [];
const resolveSymbolRefFn = ({ targetName }) => {
  resolveCalls.push(targetName);
  return { resolved: { chunkUid: `uid:${targetName}` } };
};

const resolveCached = createSymbolRefCacheResolver({
  maxEntries: 2,
  ttlMs: 50,
  nowMs: () => nowMs,
  resolveSymbolRefFn
});

assert.equal(resolveCached({ targetName: null }), null);

const firstA = resolveCached({ targetName: 'alpha', fromFile: 'a.js' });
const secondA = resolveCached({ targetName: 'alpha', fromFile: 'a.js' });
assert.deepEqual(firstA, secondA, 'expected cached value reuse for identical key');
assert.deepEqual(resolveCalls, ['alpha']);

resolveCached({ targetName: 'beta', fromFile: 'a.js' });
assert.deepEqual(resolveCalls, ['alpha', 'beta']);

resolveCached({ targetName: 'gamma', fromFile: 'a.js' });
assert.deepEqual(resolveCalls, ['alpha', 'beta', 'gamma'], 'third unique key should resolve and trigger LRU trim');

resolveCached({ targetName: 'alpha', fromFile: 'a.js' });
assert.deepEqual(resolveCalls, ['alpha', 'beta', 'gamma', 'alpha'], 'oldest entry should be evicted once capacity is exceeded');

nowMs += 100;
resolveCached({ targetName: 'beta', fromFile: 'a.js' });
assert.deepEqual(resolveCalls, ['alpha', 'beta', 'gamma', 'alpha', 'beta'], 'expired entries should be refreshed after TTL cutoff');

console.log('symbol-ref cache resolver test passed');
