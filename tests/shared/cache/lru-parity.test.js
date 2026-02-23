#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createLruCache } from '../../../src/shared/cache.js';
import { createIndexCache } from '../../../src/retrieval/index-cache.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const evictions = [];
const cache = createLruCache({
  name: 'parity',
  maxEntries: 2,
  onEvict: ({ key, reason }) => {
    evictions.push({ key, reason });
  }
});
cache.set('a', { value: 1 });
cache.set('b', { value: 2 });
assert.deepEqual(cache.get('a'), { value: 1 });
cache.set('c', { value: 3 });
assert.equal(cache.get('b'), null);
assert.deepEqual(cache.get('a'), { value: 1 });
assert.deepEqual(cache.get('c'), { value: 3 });
assert.equal(cache.size(), 2);
assert.ok(evictions.some((entry) => entry.key === 'b' && entry.reason === 'evict'));

const indexCache = createIndexCache({ maxEntries: 1, ttlMs: 0 });
indexCache.set('first', { signature: 's1', value: 1 });
assert.deepEqual(indexCache.get('first'), { signature: 's1', value: 1 });
indexCache.set('second', { signature: 's2', value: 2 });
assert.equal(indexCache.get('first'), null);
assert.deepEqual(indexCache.get('second'), { signature: 's2', value: 2 });

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'sqlite-cache-parity');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });
const dbPath = path.join(outDir, 'index.db');
await fsPromises.writeFile(dbPath, 'v1', 'utf8');

let closed = 0;
const sqliteCache = createSqliteDbCache({ maxEntries: 2, ttlMs: 0 });
sqliteCache.set(dbPath, {
  close() {
    closed += 1;
  }
});
assert.ok(sqliteCache.get(dbPath), 'expected sqlite cache hit for original signature');

await new Promise((resolve) => setTimeout(resolve, 20));
await fsPromises.writeFile(dbPath, 'v2', 'utf8');
assert.equal(sqliteCache.get(dbPath), null, 'expected sqlite cache miss after file signature change');
assert.ok(closed >= 1, 'expected sqlite cache eviction to close stale db handle');

sqliteCache.closeAll();
assert.equal(sqliteCache.size(), 0);

console.log('shared/retrieval lru parity ok.');
