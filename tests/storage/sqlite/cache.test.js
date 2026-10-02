#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-sqlite-cache-'));
const dbPath = path.join(tempRoot, 'index.db');
const otherPath = path.join(tempRoot, 'other.db');
const caches = [];
const makeCache = (options) => {
  const cache = createSqliteDbCache(options);
  caches.push(cache);
  return cache;
};
const makeDb = ({ fail = false } = {}) => ({
  closes: 0,
  close() {
    this.closes += 1;
    if (fail) throw new Error('injected close failure');
  }
});

try {
  await fs.writeFile(dbPath, 'initial');
  await fs.writeFile(otherPath, 'other');
  const cache = makeCache({ maxEntries: 1 });
  const db = makeDb();
  cache.set(dbPath, db);
  assert.equal(cache.get(dbPath), db, 'legacy get should return the raw handle');
  await fs.writeFile(dbPath, 'changed-value');
  assert.equal(cache.get(dbPath), null, 'should invalidate on signature change');
  assert.equal(db.closes, 1, 'unleased invalidation should close immediately');

  const raw = makeDb();
  cache.set(dbPath, raw);
  cache.set(otherPath, makeDb());
  assert.equal(raw.closes, 1, 'legacy unleased LRU eviction should close immediately');
  cache.closeAll();

  const first = makeDb();
  const second = makeDb();
  const lease = cache.setAndAcquire(dbPath, first);
  const overlapping = cache.acquire(dbPath);
  assert.equal(lease.db, first);
  assert.equal(overlapping.db, first);
  const next = cache.setAndAcquire(otherPath, second);
  assert.equal(cache.size(), 1);
  assert.equal(cache.acquire(dbPath), null, 'eviction must remove discoverability immediately');
  assert.equal(first.closes, 0, 'a handle must be pinned before insertion can evict it');
  lease.release();
  lease.release();
  assert.equal(first.closes, 0, 'another active lease must keep the retired handle open');
  overlapping.release();
  assert.equal(first.closes, 1, 'the last lease must close the retired handle exactly once');
  next.release();
  assert.equal(second.closes, 0, 'release must leave an active cache entry reusable');
  cache.closeAll();
  assert.equal(second.closes, 1);

  const oldDb = makeDb();
  const replacementDb = makeDb();
  const oldLease = cache.setAndAcquire(dbPath, oldDb, { generationTag: 'same-tag' });
  const replacement = cache.setAndAcquire(dbPath, replacementDb, { generationTag: 'same-tag' });
  cache.close(dbPath, { generationTag: 'same-tag', expectedDb: oldDb });
  assert.equal(cache.get(dbPath, { generationTag: 'same-tag' }), replacementDb,
    'a stale invalidator must not evict a replacement under the same tag');
  oldLease.release();
  assert.equal(oldDb.closes, 1);
  assert.equal(replacementDb.closes, 0);
  cache.closeAll();
  assert.equal(cache.size(), 0);
  assert.equal(replacementDb.closes, 0, 'closeAll must retire active leases without closing them');
  replacement.release();
  replacement.release();
  assert.equal(replacementDb.closes, 1);

  const changedDb = makeDb();
  const changed = cache.setAndAcquire(dbPath, changedDb);
  await fs.writeFile(dbPath, 'changed-signature-again');
  assert.equal(cache.acquire(dbPath), null);
  assert.equal(changedDb.closes, 0, 'signature invalidation must preserve live requests');
  changed.release();
  assert.equal(changedDb.closes, 1);

  const expiring = makeCache({ ttlMs: 1 });
  const expiredDb = makeDb();
  const expiredLease = expiring.setAndAcquire(dbPath, expiredDb);
  await delay(30);
  assert.equal(expiring.acquire(dbPath), null, 'expired entries must miss');
  assert.equal(expiredDb.closes, 0, 'expiry must not close a leased handle');
  expiredLease.release();
  assert.equal(expiredDb.closes, 1);

  const disabled = makeCache({ maxEntries: 0 });
  const disabledDb = makeDb();
  const detached = disabled.setAndAcquire(dbPath, disabledDb);
  assert.equal(detached.db, disabledDb);
  assert.equal(disabled.acquire(dbPath), null);
  assert.equal(disabled.size(), 0);
  disabled.closeAll();
  assert.equal(disabledDb.closes, 0, 'a disabled cache must transfer ownership to the lease');
  detached.release();
  detached.release();
  assert.equal(disabledDb.closes, 1);

  const terminalDb = makeDb();
  const terminal = cache.setAndAcquire(dbPath, terminalDb);
  cache.dispose();
  cache.dispose();
  assert.equal(cache.acquire(dbPath), null);
  assert.equal(cache.size(), 0);
  assert.equal(terminalDb.closes, 0, 'terminal disposal must preserve outstanding leases');
  terminal.release();
  assert.equal(terminalDb.closes, 1);
  const afterDisposeDb = makeDb();
  const afterDispose = cache.setAndAcquire(dbPath, afterDisposeDb);
  assert.equal(cache.acquire(dbPath), null, 'disposed caches must not be reactivated');
  assert.equal(cache.size(), 0);
  afterDispose.release();
  assert.equal(afterDisposeDb.closes, 1, 'later insertions must return detached owned leases');

  const failures = makeCache();
  const failingDb = makeDb({ fail: true });
  const healthyDb = makeDb();
  failures.set(dbPath, failingDb);
  failures.set(otherPath, healthyDb);
  assert.throws(() => failures.dispose(), AggregateError);
  assert.equal(failingDb.closes, 1);
  assert.equal(healthyDb.closes, 1, 'cleanup must continue after another close fails');
  assert.equal(failures.size(), 0);
  failures.dispose();
  assert.equal(failingDb.closes, 1, 'failed closes must not be attempted twice');

  const failedLeaseDb = makeDb({ fail: true });
  const failedLease = disabled.setAndAcquire(dbPath, failedLeaseDb);
  assert.throws(() => failedLease.release(), AggregateError);
  failedLease.release();
  assert.equal(failedLeaseDb.closes, 1);
} finally {
  for (const cache of caches) cache.dispose();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite cache tests passed');
