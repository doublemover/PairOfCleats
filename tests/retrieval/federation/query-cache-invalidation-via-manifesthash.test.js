#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildFederatedQueryCacheKey,
  buildFederatedQueryCacheKeyPayload,
  findFederatedQueryCacheEntry,
  loadFederatedQueryCache,
  persistFederatedQueryCache,
  upsertFederatedQueryCacheEntry
} from '../../../src/retrieval/federation/query-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-cache-manifest-'));
const cachePath = path.join(tempRoot, 'queryCache.json');
const repoSetId = 'ws1-demo';

const payload = buildFederatedQueryCacheKeyPayload({
  repoSetId,
  manifestHash: 'wm1-a',
  query: 'needle',
  selection: {
    selectedRepoIds: ['repo-a']
  },
  cohorts: {
    policy: 'default',
    modeSelections: { code: null }
  },
  search: { mode: 'code', top: 10 },
  merge: { strategy: 'rrf', rrfK: 60 },
  limits: { top: 10, perRepoTop: 20, concurrency: 2 }
});
const keyInfo = buildFederatedQueryCacheKey(payload);

const cache = await loadFederatedQueryCache({ cachePath, repoSetId });
upsertFederatedQueryCacheEntry(cache, {
  keyHash: keyInfo.keyHash,
  keyPayloadHash: keyInfo.keyPayloadHash,
  manifestHash: 'wm1-a',
  result: { ok: true, backend: 'federated', code: [], prose: [], extractedProse: [], records: [] }
});
await persistFederatedQueryCache({ cachePath, cache });

const loaded = await loadFederatedQueryCache({ cachePath, repoSetId });
const hit = findFederatedQueryCacheEntry(loaded, {
  keyHash: keyInfo.keyHash,
  manifestHash: 'wm1-a'
});
assert.ok(hit, 'expected cache hit for matching manifest hash');

const miss = findFederatedQueryCacheEntry(loaded, {
  keyHash: keyInfo.keyHash,
  manifestHash: 'wm1-b'
});
assert.equal(miss, null, 'manifest hash mismatch must invalidate cache entry');

console.log('federated query cache manifest invalidation test passed');
