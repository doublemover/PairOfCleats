#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRepoCacheManager,
  INDEX_CACHE_POLICY_DEFAULTS,
  REPO_CACHE_POLICY_DEFAULTS,
  SQLITE_CACHE_POLICY_DEFAULTS
} from '../../../src/shared/repo-cache-config.js';
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

assert.equal(sharedManager.closeRepoCaches().status, 'settled');
assert.equal(apiManager.closeRepoCaches().status, 'settled');
assert.equal(clearRepoCaches(repoRoot).status, 'settled');
const failure = Object.freeze(new Error('parity SQLite close failure'));
let allow = false, closes = 0;
const retiring = getRepoCaches(repoRoot);
retiring.sqliteCache.set('authored-parity.db', { close() { closes++; if (!allow) throw failure; } });
try {
  assert.throws(() => clearRepoCaches(repoRoot), error => error.code === 'ERR_REPO_CACHE_RETIREMENT'
    && error.cacheOwnershipReleased() === false);
  assert.equal(closes, 1);
  assert.throws(() => clearRepoCaches(repoRoot), { code: 'ERR_REPO_CACHE_RETIREMENT' });
  assert.equal(closes, 1);
} finally {
  allow = true;
  for (const owner of retiring.sqliteCache.pendingOwners()) owner.release();
  assert.equal(clearRepoCaches(repoRoot).status, 'settled');
}

console.log('repo cache config parity test passed');
