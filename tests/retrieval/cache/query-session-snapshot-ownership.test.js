import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadQueryCache, findQueryCacheEntry } from '../../../src/retrieval/query-cache.js';
import { upsertQueryCacheEntry, snapshotQueryCachePayload } from '../../../src/retrieval/query-cache-state.js';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { createQueryCacheLookupInput, createQueryCachePersistInput } from './query-cache-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-session-snapshot-'));
try {
  const input = createQueryCacheLookupInput(root);
  const miss = await resolveQueryCacheLookup(input);
  const source = [{ id: 0, file: 'original.js', docmeta: { comment: 'original' } }];
  const written = await persistSearchSession(createQueryCachePersistInput(miss, { codeHits: source }));
  assert.equal(written.cacheShouldPersist, false, 'a successful checkpoint acknowledges its dirty submission');
  source[0].docmeta.comment = 'later source mutation';
  const first = loadQueryCache(miss.queryCachePath);
  const second = loadQueryCache(miss.queryCachePath);
  assert.notEqual(first, second);
  assert.notEqual(first.entries[0], second.entries[0]);
  assert.equal(first.entries[0].payload, second.entries[0].payload);
  assert.equal(first.entries[0].payload.code[0].docmeta.comment, 'original');
  assert.throws(() => { first.entries[0].payload.code[0].docmeta.comment = 'not owned'; }, TypeError);
  first.entries[0].ts += 100000;
  assert.notEqual(first.entries[0].ts, second.entries[0].ts, 'mutable recency belongs to one session');
  first.entries[0].meta.query = 'another-session-query';
  assert.equal(second.entries[0].meta.query, 'alpha', 'nested diagnostic metadata also belongs to its session');

  const hit = await resolveQueryCacheLookup(input);
  assert.equal(hit.cacheHit, true);
  hit.cachedPayload.code[0].docmeta.comment = 'renderer-owned enrichment';
  assert.equal((await resolveQueryCacheLookup(input)).cachedPayload.code[0].docmeta.comment, 'original');

  const stale = loadQueryCache(miss.queryCachePath);
  const replacement = await persistSearchSession(createQueryCachePersistInput(miss,
    { cacheData: loadQueryCache(miss.queryCachePath), codeHits: [{ id: 'replacement' }] }));
  const replacementId = replacement.cacheData.entries.find(entry => entry.key === miss.cacheKey).payloadId;
  const staleEntry = { ...stale.entries[0], ts: Date.now() + 1000000 };
  upsertQueryCacheEntry(stale, staleEntry, { replacement: false });
  const staleFlush = await persistSearchSession(createQueryCachePersistInput(miss,
    { cacheHit: true, cacheShouldPersist: true, cacheData: stale }));
  const current = staleFlush.cacheData.entries.find(entry => entry.key === miss.cacheKey);
  assert.equal(current.payloadId, replacementId);
  assert.equal(current.payload.code[0].id, 'replacement');
  assert.notEqual(current.ts, staleEntry.ts, 'a stale full checkpoint cannot transfer recency to another payload');

  const beforeEviction = loadQueryCache(miss.queryCachePath);
  const evicting = loadQueryCache(miss.queryCachePath);
  upsertQueryCacheEntry(evicting, { key: 'survivor', signature: miss.cacheSignature, payloadId: 'owned-survivor',
    ts: Date.now() + 100000, payload: snapshotQueryCachePayload({ code: [{ id: 'survivor' }], prose: [], extractedProse: [], records: [] }) });
  await persistSearchSession(createQueryCachePersistInput(miss, { cacheKey: 'survivor', cacheData: evicting,
    cacheHit: true, cacheShouldPersist: true, queryCacheMaxEntries: 1 }));
  const survivor = loadQueryCache(miss.queryCachePath).entries[0];
  assert.equal(survivor.key, 'survivor');
  const removed = beforeEviction.entries.find(entry => entry.key !== survivor.key);
  assert.ok(removed);
  upsertQueryCacheEntry(beforeEviction, { ...removed, ts: Date.now() + 1000000 }, { replacement: false });
  await persistSearchSession(createQueryCachePersistInput(miss,
    { cacheData: beforeEviction, cacheHit: true, cacheShouldPersist: true }));
  assert.equal(loadQueryCache(miss.queryCachePath).entries.some(entry => entry.key === removed.key), false);

  const controller = new AbortController();
  const lock = await acquireFileLock({ lockPath: `${miss.queryCachePath}.lock`, waitMs: 1000, timeoutBehavior: 'throw' });
  let pending;
  try {
    pending = persistSearchSession(createQueryCachePersistInput(miss, { cacheKey: 'cancelled-before-publication', cacheData: null, signal: controller.signal }));
    controller.abort();
  } finally { await lock.release(); }
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(findQueryCacheEntry(null, 'cancelled-before-publication', miss.cacheSignature,
    { cachePath: miss.queryCachePath, strategy: 'memory-first' }), null);
  assert.equal(loadQueryCache(miss.queryCachePath).entries.some(entry => entry.key === 'cancelled-before-publication'), false);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual query-session consumers isolate payload/metadata ownership and preserve replacement, eviction, and cancellation authority.');
