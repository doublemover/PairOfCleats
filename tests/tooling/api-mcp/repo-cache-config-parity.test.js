#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRepoCacheManager,
  INDEX_CACHE_POLICY_DEFAULTS,
  REPO_CACHE_POLICY_DEFAULTS,
  SQLITE_CACHE_POLICY_DEFAULTS
} from '../../../tools/shared/repo-cache-config.js';
import { createRepoCacheManager as createApiRepoCacheManager } from '../../../tools/api/router/cache.js';
import { clearRepoCaches, getRepoCaches, refreshRepoCaches } from '../../../tools/mcp/repo.js';

const repoRoot = process.cwd();

const sharedManager = createRepoCacheManager({
  defaultRepo: repoRoot,
  namespace: 'parity'
});
const apiManager = createApiRepoCacheManager({
  defaultRepo: repoRoot
});

assert.equal(sharedManager.repoCacheConfig.maxEntries, REPO_CACHE_POLICY_DEFAULTS.maxEntries);
assert.equal(sharedManager.repoCacheConfig.ttlMs, REPO_CACHE_POLICY_DEFAULTS.ttlMs);
assert.equal(sharedManager.indexCacheConfig.maxEntries, INDEX_CACHE_POLICY_DEFAULTS.maxEntries);
assert.equal(sharedManager.sqliteCacheConfig.maxEntries, SQLITE_CACHE_POLICY_DEFAULTS.maxEntries);

assert.equal(apiManager.repoCacheConfig.maxEntries, sharedManager.repoCacheConfig.maxEntries);
assert.equal(apiManager.repoCacheConfig.ttlMs, sharedManager.repoCacheConfig.ttlMs);
assert.equal(apiManager.indexCacheConfig.maxEntries, sharedManager.indexCacheConfig.maxEntries);
assert.equal(apiManager.sqliteCacheConfig.maxEntries, sharedManager.sqliteCacheConfig.maxEntries);

const sharedEntry = sharedManager.getRepoCaches(repoRoot);
const apiEntry = apiManager.getRepoCaches(repoRoot);
const mcpEntry = getRepoCaches(repoRoot);

assert.ok(sharedEntry.indexCache && sharedEntry.sqliteCache);
assert.ok(apiEntry.indexCache && apiEntry.sqliteCache);
assert.ok(mcpEntry.indexCache && mcpEntry.sqliteCache);

await sharedManager.refreshRepoCaches(repoRoot);
await refreshRepoCaches(repoRoot);

sharedManager.closeRepoCaches();
apiManager.closeRepoCaches();
clearRepoCaches(repoRoot);

console.log('repo cache config parity test passed');
