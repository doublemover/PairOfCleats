import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadFederatedQueryCache, upsertFederatedQueryCacheEntry,
  persistFederatedQueryCache, findFederatedQueryCacheEntry } from '../../../src/retrieval/federation/query-cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-cache-reader-budget-'));
try {
  const cachePath = path.join(root, 'cache.json');
  const repoSetId = 'reader-budget';
  const policy = { maxEntries: 8, maxBytes: 64 * 1024 * 1024, maxAgeDays: 30 };
  const cache = await loadFederatedQueryCache({ cachePath, repoSetId });
  upsertFederatedQueryCacheEntry(cache, { keyHash: 'unreadable', manifestHash: 'generation',
    result: { marker: 'x'.repeat(16 * 1024 * 1024) }, policy });
  assert.deepEqual(Object.keys(cache.entries), [], 'a permissive optional budget cannot admit payloads exceeding the canonical reader limit');
  upsertFederatedQueryCacheEntry(cache, { keyHash: 'readable', manifestHash: 'generation',
    result: { marker: 'x'.repeat(1024 * 1024) }, policy });
  await persistFederatedQueryCache({ cachePath, cache });
  assert.ok((await fs.stat(cachePath)).size < 16 * 1024 * 1024);
  const reloaded = await loadFederatedQueryCache({ cachePath, repoSetId });
  assert.equal(findFederatedQueryCacheEntry(reloaded, { keyHash: 'readable', manifestHash: 'generation', policy }).result.marker.length,
    1024 * 1024, 'the writer preserves usable payloads within its own reader limit');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Federated canonical checkpoints cannot exceed their bounded reader despite a larger optional retention policy.');
