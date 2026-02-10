#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findQueryCacheEntry,
  loadQueryCache,
  pruneQueryCache
} from '../../../src/retrieval/query-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-query-cache-lookup-'));
const cachePath = path.join(tempRoot, 'queryCache.json');

await fs.writeFile(cachePath, JSON.stringify({
  version: 1,
  entries: [
    { key: 'k1', signature: 's1', ts: 100, payload: { code: [{ id: 1 }] } },
    { key: 'k1', signature: 's1', ts: 200, payload: { code: [{ id: 2 }] } },
    { key: 'k2', signature: 's2', ts: 150, payload: { code: [{ id: 3 }] } }
  ]
}, null, 2));

const cache = loadQueryCache(cachePath);
const entry = findQueryCacheEntry(cache, 'k1', 's1');
assert.ok(entry, 'expected cache entry lookup');
assert.equal(entry.ts, 200, 'expected newest entry for key/signature');

cache.entries.push({ key: 'k1', signature: 's1', ts: 250, payload: { code: [{ id: 4 }] } });
const updated = findQueryCacheEntry(cache, 'k1', 's1');
assert.ok(updated, 'expected cache entry lookup after in-memory mutation');
assert.equal(updated.ts, 250, 'expected lookup index refresh after mutation');

pruneQueryCache(cache, 2);
const stillPresent = findQueryCacheEntry(cache, 'k1', 's1');
assert.ok(stillPresent, 'expected lookup to remain available after prune');
assert.equal(stillPresent.ts, 250, 'expected newest entry retained after prune');

console.log('query cache lookup test passed');
