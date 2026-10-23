import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { loadQueryCache, pruneQueryCache, findQueryCacheEntry, rememberQueryCacheEntry } from '../../../src/retrieval/query-cache.js';
import { snapshotQueryCachePayload, upsertQueryCacheEntry } from '../../../src/retrieval/query-cache-state.js';
import { createQueryCacheLookupInput, createQueryCachePersistInput } from './query-cache-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-session-freshness-'));
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
try {
  const input = createQueryCacheLookupInput(root, { cacheMemoryFreshMs: 100, queryCacheTtlMs: 1000 });
  const miss = await resolveQueryCacheLookup(input);
  await persistSearchSession(createQueryCachePersistInput(miss, { queryCacheTtlMs: 1000, codeHits: [{ id: 'original' }] }));
  const originalEntry = findQueryCacheEntry(null, miss.cacheKey, miss.cacheSignature,
    { cachePath: miss.queryCachePath, strategy: 'memory-first' });
  const start = now;
  for (const elapsed of [10, 50, 90]) {
    now = start + elapsed;
    const hit = await resolveQueryCacheLookup(input);
    assert.equal(hit.cacheHit, true);
    assert.equal(hit.cacheHotPathHit, true);
    assert.equal(hit.cachedPayload.code[0].id, 'original');
  }
  now = start + 95;
  await persistSearchSession(createQueryCachePersistInput(miss, { cacheData: loadQueryCache(miss.queryCachePath),
    codeHits: [{ id: 'external-replacement' }], queryCacheTtlMs: 1000 }));
  // Reinstall the original in-memory observation to model another process's
  // still-resident payload; the canonical writer has published its replacement.
  originalEntry.ts = start + 90;
  rememberQueryCacheEntry(miss.queryCachePath, miss.cacheKey, miss.cacheSignature, originalEntry, 32);
  now = start + 110;
  const refreshed = await resolveQueryCacheLookup(input);
  assert.equal(refreshed.cacheHit, true);
  assert.equal(refreshed.cacheHotPathHit, false, 'sliding recency cannot indefinitely extend the validation freshness window');
  assert.equal(refreshed.cachedPayload.code[0].id, 'external-replacement');
  const beforeExpired = await fs.readFile(`${miss.queryCachePath}.touches.json`, 'utf8');
  now = start + 2000;
  assert.equal((await resolveQueryCacheLookup(input)).cacheHit, false);
  assert.equal(await fs.readFile(`${miss.queryCachePath}.touches.json`, 'utf8'), beforeExpired, 'expired entries are not revived by a touch');

  const malformed = { ...originalEntry, ts: 'invalid-clock', payloadId: 'malformed-payload' };
  rememberQueryCacheEntry(miss.queryCachePath, miss.cacheKey, miss.cacheSignature, malformed, 32);
  assert.equal((await resolveQueryCacheLookup({ ...input, cacheMemoryFreshMs: 0 })).cacheHit, false,
    'malformed resident timestamps cannot become immortal sliding hits');
  assert.equal(await fs.readFile(`${miss.queryCachePath}.touches.json`, 'utf8'), beforeExpired);

  const blocked = path.join(root, 'blocked');
  await fs.writeFile(blocked, 'ordinary file');
  const failed = await persistSearchSession(createQueryCachePersistInput(miss, { queryCachePath: path.join(blocked, 'cache.json'),
    cacheKey: 'failed-flush', cacheData: null, codeHits: [{ id: 'retained-after-failure' }] }));
  assert.equal(failed.cacheShouldPersist, true, 'best-effort publication failure retains a dirty receipt');
  await fs.rm(blocked);
  await fs.mkdir(blocked);
  const recovered = await persistSearchSession(createQueryCachePersistInput(miss, { ...failed,
    queryCachePath: path.join(blocked, 'cache.json'), cacheKey: 'failed-flush', cacheHit: true }));
  assert.equal(recovered.cacheShouldPersist, false);
  assert.equal(loadQueryCache(path.join(blocked, 'cache.json')).entries[0].payload.code[0].id, 'retained-after-failure');

  const equal = { version: 1, entries: [] };
  for (const key of ['first', 'second']) upsertQueryCacheEntry(equal, { key, signature: 'generation', payloadId: key, ts: now,
    payload: snapshotQueryCachePayload({ code: [{ id: key }] }) });
  pruneQueryCache(equal, 1);
  assert.deepEqual(equal.entries.map(entry => entry.key), ['first'], 'equal timestamp retention preserves stable prior order');
  const marker = 'immutable-payload-byte-accounting-'.repeat(2048);
  const accounted = { version: 1, entries: [{ key: 'payload', signature: 'g', ts: now,
    payload: snapshotQueryCachePayload({ marker }) }] };
  const originalStringify = JSON.stringify;
  let payloadSerializations = 0;
  try {
    JSON.stringify = function (...args) {
      const result = originalStringify.apply(this, args);
      if (result?.includes(marker)) payloadSerializations++;
      return result;
    };
    for (let count = 0; count < 8; count++) pruneQueryCache(accounted, 32);
    assert.equal(payloadSerializations, 0, 'retained immutable payload byte sizes do not require repeated serialization');
  } finally { JSON.stringify = originalStringify; }
} finally {
  Date.now = originalNow;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Actual query-cache consumers separate validation freshness from sliding TTL, retain failed flushes, and reuse immutable byte accounting.');
