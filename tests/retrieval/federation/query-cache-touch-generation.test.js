import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadFederatedQueryCache, upsertFederatedQueryCacheEntry, persistFederatedQueryCache,
  findFederatedQueryCacheEntry, touchFederatedQueryCacheEntry, persistFederatedQueryCacheTouch,
  pruneFederatedQueryCache
} from '../../../src/retrieval/federation/query-cache.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('federation-touch-generation');
const policy = { maxEntries: 8, maxAgeDays: 30, maxBytes: 2 * 1024 * 1024 };
const marker = 'federation-immutable-payload-'.repeat(4096);
try {
  const cachePath = path.join(dir, 'cache.json'), repoSetId = 'test-repo-set';
  let cache = await loadFederatedQueryCache({ cachePath, repoSetId });
  const originalTime = Date.now() - 1000;
  upsertFederatedQueryCacheEntry(cache, { keyHash: 'a', manifestHash: 'generation-a', result: { marker }, now: new Date(originalTime).toISOString(), policy });
  await persistFederatedQueryCache({ cachePath, cache });
  const canonical = await fs.readFile(cachePath, 'utf8');
  const originalOpen = fs.open;
  let payloadReads = 0;
  try {
    fs.open = async function (file, ...args) {
      if (String(file) === cachePath) payloadReads++;
      return originalOpen.call(this, file, ...args);
    };
    cache = await loadFederatedQueryCache({ cachePath, repoSetId });
    const first = cache.entries.a.result;
    for (let request = 0; request < 4; request++) {
      const next = await loadFederatedQueryCache({ cachePath, repoSetId });
      assert.equal(next.entries.a.result, first, 'unchanged generation shares only frozen immutable payloads');
      assert.notEqual(next.entries.a, cache.entries.a, 'request recency metadata has independent ownership');
      cache = next;
    }
    assert.equal(payloadReads, 1);
    assert.throws(() => { first.marker = 'mutated'; }, TypeError);
  } finally { fs.open = originalOpen; }

  const refreshed = originalTime + 500;
  touchFederatedQueryCacheEntry(cache, 'a', new Date(refreshed).toISOString());
  const lock = await acquireFileLock({ lockPath: `${cachePath}.lock`, waitMs: 1000, timeoutBehavior: 'throw' });
  let settled = false;
  const pending = persistFederatedQueryCacheTouch({ cachePath, cache, keyHash: 'a', maxEntries: 8 }).finally(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'touch publication is awaited and shares the canonical writer lock');
  await lock.release();
  assert.equal(await pending, true);
  assert.equal(await fs.readFile(cachePath, 'utf8'), canonical);
  const touched = await loadFederatedQueryCache({ cachePath, repoSetId });
  assert.equal(Date.parse(touched.entries.a.lastUsedAt), refreshed);
  assert.ok(findFederatedQueryCacheEntry(touched, { keyHash: 'a', manifestHash: 'generation-a', policy: { maxAgeDays: 1 / 86400 }, now: refreshed + 900 }));
  assert.equal(findFederatedQueryCacheEntry(touched, { keyHash: 'a', manifestHash: 'generation-a', policy: { maxAgeDays: 1 / 86400 }, now: refreshed + 1100 }), null);
  pruneFederatedQueryCache(touched, policy);
  const originalStringify = JSON.stringify;
  let payloadSerializations = 0;
  try {
    JSON.stringify = function (...args) {
      const serialized = originalStringify.apply(this, args);
      if (serialized?.includes(marker)) payloadSerializations++;
      return serialized;
    };
    touchFederatedQueryCacheEntry(touched, 'a');
    pruneFederatedQueryCache(touched, policy);
    assert.equal(payloadSerializations, 0, 'byte accounting reuses the serialized size of an immutable result');
    upsertFederatedQueryCacheEntry(touched, { keyHash: 'checkpoint-small', manifestHash: 'generation-a',
      result: { small: true }, policy });
    await persistFederatedQueryCache({ cachePath, cache: touched });
    assert.equal(payloadSerializations, 1, 'a full checkpoint serializes a retained payload only for the final durable envelope');
  } finally { JSON.stringify = originalStringify; }

  const staleLeft = await loadFederatedQueryCache({ cachePath, repoSetId });
  const staleRight = await loadFederatedQueryCache({ cachePath, repoSetId });
  upsertFederatedQueryCacheEntry(staleLeft, { keyHash: 'left', manifestHash: 'generation-a', result: { left: true }, policy });
  upsertFederatedQueryCacheEntry(staleRight, { keyHash: 'right', manifestHash: 'generation-a', result: { right: true }, policy });
  await Promise.all([persistFederatedQueryCache({ cachePath, cache: staleLeft }), persistFederatedQueryCache({ cachePath, cache: staleRight })]);
  const merged = await loadFederatedQueryCache({ cachePath, repoSetId });
  assert.deepEqual(Object.keys(merged.entries).sort(), ['a', 'checkpoint-small', 'left', 'right']);
  upsertFederatedQueryCacheEntry(merged, { keyHash: 'a', manifestHash: 'generation-b', result: { fresh: true }, policy });
  await persistFederatedQueryCache({ cachePath, cache: merged });
  touchFederatedQueryCacheEntry(cache, 'a', new Date(Date.now() + 100000).toISOString());
  await persistFederatedQueryCacheTouch({ cachePath, cache, keyHash: 'a', maxEntries: 8 });
  const replaced = await loadFederatedQueryCache({ cachePath, repoSetId });
  assert.equal(replaced.entries.a.manifestHash, 'generation-b');
  assert.notEqual(replaced.entries.a.lastUsedAt, cache.entries.a.lastUsedAt, 'old payload touches do not extend replacement TTL');
  assert.ok((await fs.stat(`${cachePath}.touches.json`)).size < 4096);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Federated result payloads are generation-reused while bounded awaited touches preserve sliding TTL and concurrent merges.');
