import assert from 'node:assert/strict';
import { resolveDefaultTestCacheScope } from './test-cache.js';

assert.equal(resolveDefaultTestCacheScope('ci'), 'shared', 'ci lane should default to shared cache scope');
assert.equal(resolveDefaultTestCacheScope('ci-long'), 'shared', 'ci-long lane should default to shared cache scope');
assert.equal(resolveDefaultTestCacheScope('ci-lite'), 'isolated', 'ci-lite lane should default to isolated cache scope');
assert.equal(resolveDefaultTestCacheScope('smoke'), 'isolated', 'non-ci lanes should default to isolated cache scope');
assert.equal(resolveDefaultTestCacheScope(''), 'isolated', 'empty lane should default to isolated cache scope');

console.log('lane default cache scope test passed');
