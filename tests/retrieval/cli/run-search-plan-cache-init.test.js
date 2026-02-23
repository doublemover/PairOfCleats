#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRunSearchPlanCache } from '../../../src/retrieval/cli/run-search/plan-cache-init.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const existingCache = { id: 'existing' };
let resolveCalls = 0;
let createCalls = 0;
const reused = resolveRunSearchPlanCache({
  queryPlanCache: existingCache,
  queryCacheDir: 'cache',
  metricsDir: 'metrics',
  resolveRetrievalCachePath() {
    resolveCalls += 1;
    return 'unused';
  },
  createQueryPlanDiskCache() {
    createCalls += 1;
    return {};
  }
});
assert.equal(reused, existingCache);
assert.equal(resolveCalls, 0);
assert.equal(createCalls, 0);

const unresolved = resolveRunSearchPlanCache({
  queryPlanCache: null,
  queryCacheDir: 'cache',
  metricsDir: 'metrics',
  resolveRetrievalCachePath() {
    return null;
  },
  createQueryPlanDiskCache() {
    throw new Error('should not create cache when path is unresolved');
  }
});
assert.equal(unresolved, null);

let loaded = 0;
const created = resolveRunSearchPlanCache({
  queryPlanCache: null,
  queryCacheDir: 'cache',
  metricsDir: 'metrics',
  resolveRetrievalCachePath(input) {
    assert.equal(input.fileName, 'queryPlanCache.json');
    return 'C:/tmp/queryPlanCache.json';
  },
  createQueryPlanDiskCache(input) {
    assert.equal(input.path, 'C:/tmp/queryPlanCache.json');
    return {
      load() {
        loaded += 1;
      }
    };
  }
});
assert.equal(typeof created, 'object');
assert.equal(loaded, 1);

console.log('run-search plan cache init helper test passed');
