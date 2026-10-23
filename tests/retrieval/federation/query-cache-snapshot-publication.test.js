import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadFederatedQueryCache, upsertFederatedQueryCacheEntry, persistFederatedQueryCache,
  touchFederatedQueryCacheEntry
} from '../../../src/retrieval/federation/query-cache.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-snapshot-publication-'));
const cachePath = path.join(root, 'queryCache.json');
const repoSetId = 'snapshot-publication';
const policy = { maxEntries: 10, maxAgeDays: 30 };
const load = () => loadFederatedQueryCache({ cachePath, repoSetId });
const insert = (cache, keyHash, value, now = new Date().toISOString()) => upsertFederatedQueryCacheEntry(cache, {
  keyHash, manifestHash: 'same-manifest', result: { value }, now, policy
});
const persist = cache => persistFederatedQueryCache({ cachePath, cache });

try {
  const seed = await load();
  insert(seed, 'base', 'original');
  await persist(seed);

  // The first physical load must have the same metadata isolation as parsed
  // memory hits; unpublished edits cannot become another request's snapshot.
  const firstLoad = await load();
  const originalTime = firstLoad.entries.base.lastUsedAt;
  insert(firstLoad, 'private', 'unpublished');
  touchFederatedQueryCacheEntry(firstLoad, 'base', '2099-01-01T00:00:00.000Z');
  const otherLoad = await load();
  assert.equal(otherLoad.entries.private, undefined);
  assert.equal(otherLoad.entries.base.lastUsedAt, originalTime);
  assert.notEqual(firstLoad.entries.base, otherLoad.entries.base);
  assert.equal(firstLoad.entries.base.result, otherLoad.entries.base.result,
    'only immutable payload data may be shared between snapshots');

  const staleTouch = await load();
  const replacement = await load();
  insert(replacement, 'base', 'replacement');
  const replacementId = replacement.entries.base.payloadId;
  await persist(replacement);
  touchFederatedQueryCacheEntry(staleTouch, 'base', '2099-01-02T00:00:00.000Z');
  insert(staleTouch, 'independent', 'new-key');
  await persist(staleTouch);
  const afterStaleWrite = await load();
  assert.equal(afterStaleWrite.entries.base.result.value, 'replacement');
  assert.equal(afterStaleWrite.entries.base.payloadId, replacementId);
  assert.notEqual(afterStaleWrite.entries.base.lastUsedAt, staleTouch.entries.base.lastUsedAt);
  assert.equal(afterStaleWrite.entries.independent.result.value, 'new-key');

  // A once-published replacement is no longer dirty when its original request
  // writes again. A future touch must not turn it into another replacement.
  const newer = await load();
  insert(newer, 'base', 'newer');
  await persist(newer);
  touchFederatedQueryCacheEntry(replacement, 'base', '2099-01-03T00:00:00.000Z');
  await persist(replacement);
  assert.equal((await load()).entries.base.result.value, 'newer');

  const beforeEviction = await load();
  const evicting = await load();
  upsertFederatedQueryCacheEntry(evicting, { keyHash: 'survivor', manifestHash: 'same-manifest',
    result: { value: 'survivor' }, now: '2099-01-04T00:00:00.000Z', policy: { ...policy, maxEntries: 1 } });
  await persist(evicting);
  assert.deepEqual(Object.keys((await load()).entries), ['survivor']);
  touchFederatedQueryCacheEntry(beforeEviction, 'base', '2099-01-05T00:00:00.000Z');
  await persist(beforeEviction);
  assert.deepEqual(Object.keys((await load()).entries), ['survivor'], 'stale full writes cannot resurrect evicted payloads');

  // Capture the submission before awaiting the lock. Later request edits remain
  // dirty for the next deliberate flush and cannot leak into this publication.
  const waiting = await load();
  insert(waiting, 'submitted', 'submitted');
  const lock = await acquireFileLock({ lockPath: `${cachePath}.lock`, waitMs: 1000, timeoutBehavior: 'throw' });
  let flush;
  try {
    flush = persist(waiting);
    insert(waiting, 'later', 'later');
  } finally { await lock.release(); }
  await flush;
  assert.equal((await load()).entries.later, undefined);
  await persist(waiting);
  assert.equal((await load()).entries.later.result.value, 'later');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Federated cache snapshots publish explicit payload changes and retain generation-safe recency ownership.');
