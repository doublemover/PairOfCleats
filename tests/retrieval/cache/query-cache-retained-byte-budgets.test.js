import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadQueryCache, findQueryCacheEntry, rememberQueryCacheEntry, pruneQueryCache } from '../../../src/retrieval/query-cache.js';
import { snapshotQueryCachePayload } from '../../../src/retrieval/query-cache-state.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-retained-budget-'));
try {
  const marker = 'x'.repeat(3 * 1024 * 1024);
  const frozen = snapshotQueryCachePayload({ marker });
  for (let index = 0; index < 6; index++) {
    const cachePath = path.join(root, `hot-${index}.json`);
    rememberQueryCacheEntry(cachePath, 'key', 'signature', { ts: Date.now(), payload: frozen }, 1);
  }
  assert.equal(findQueryCacheEntry(null, 'key', 'signature', { cachePath: path.join(root, 'hot-0.json'), strategy: 'memory-first' }), null,
    'aggregate serialized-byte retention bounds paths before the independent path-count cap');
  assert.ok(findQueryCacheEntry(null, 'key', 'signature', { cachePath: path.join(root, 'hot-5.json'), strategy: 'memory-first' }));

  const originalPayloads = [];
  for (let index = 0; index < 6; index++) {
    const cachePath = path.join(root, `disk-${index}.json`);
    await fs.writeFile(cachePath, JSON.stringify({ version: 1, entries: [{ key: 'key', signature: 'signature', ts: Date.now(), payload: { marker } }] }));
    originalPayloads.push(loadQueryCache(cachePath).entries[0].payload);
  }
  assert.equal(loadQueryCache(path.join(root, 'disk-5.json')).entries[0].payload, originalPayloads[5]);
  assert.notEqual(loadQueryCache(path.join(root, 'disk-0.json')).entries[0].payload, originalPayloads[0],
    'aggregate parsed-cache bytes evict the oldest payload memo while preserving cold reload authority');
  const oversized = { version: 1, entries: [{ key: 'too-large', signature: 'signature', ts: Date.now(),
    payload: snapshotQueryCachePayload({ marker: 'x'.repeat(8 * 1024 * 1024) }) }] };
  pruneQueryCache(oversized, 512);
  assert.deepEqual(oversized.entries, [], 'a checkpoint cannot produce a cache larger than its own bounded reader accepts');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Query caches bound aggregate serialized payload retention and checkpoint size independently of entry/path counts.');
