import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { getPendingSqliteCacheOwners, getSqliteCacheFailureOwner } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual cache/LRU/lease owner with inert original synchronous native boundaries.
// Component control; no database binding, child, IPC, executable or parser is used.
const root = await makeTempDir('sqlite-cache-close-owner-');
const baseline = new Set(getPendingSqliteCacheOwners()), caches = [], finish = [];
const caught = action => { let failed = false, value; try { action(); } catch (error) { failed = true; value = error; }
  assert.equal(failed, true); return value; };
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (!current || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
const cacheFor = options => { const cache = createSqliteDbCache(options); caches.push(cache); return cache; };
try {
  const first = path.join(root, 'first.db'), second = path.join(root, 'second.db');
  await fs.writeFile(first, 'ordinary identity'); await fs.writeFile(second, 'second identity');
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original close'))]) {
    let permitted = false, calls = 0, closeReads = 0;
    finish.push(() => { permitted = true; });
    const db = { get close() { closeReads++; return function() {
      assert.equal(this, db); calls++; if (!permitted) throw value; return db;
    }; } };
    const cache = cacheFor({ maxEntries: 1 }); cache.set(first, db);
    cache.set(second, { close() {} });
    assert.equal(cache.get(first), null); assert.equal(calls, 1); assert.equal(closeReads, 1);
    const owner = cache.pendingOwners()[0];
    assert.equal(owner.db, db); assert.equal(owner.isSettled(), false);
    assert.ok(getPendingSqliteCacheOwners().includes(owner), 'implicit eviction cannot lose the failed handle scope');
    const failure = caught(() => cache.dispose());
    assert.equal(contains(failure, value), true); assert.equal(failure.cacheOwnershipReleased(), false);
    caught(() => cache.dispose()); assert.equal(calls, 1, 'ordinary disposal never retries native failure');
    const original = owner.lastError;
    assert.equal(getSqliteCacheFailureOwner(original), owner);
    assert.equal(getSqliteCacheFailureOwner({ sqliteCacheOwner: owner }), null);
    permitted = true; assert.deepEqual(owner.release(), { settled: true, pending: false });
    assert.equal(calls, 2); assert.equal(closeReads, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    cache.dispose(); assert.equal(calls, 2);
  }
  {
    let settled = false, allowClose = false, calls = 0;
    finish.push(() => { settled = true; allowClose = true; });
    const primary = Object.assign(new Error('original close owns pending native work'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
    });
    const db = { close() { assert.equal(this, db); calls++; if (!allowClose) throw primary; } };
    const cache = cacheFor({ maxEntries: 0 }), lease = cache.setAndAcquire(first, db);
    const failure = caught(() => lease.release());
    const owner = cache.pendingOwners()[0];
    db.close = () => assert.fail('original close cannot be replaced');
    primary.cacheOwnershipReleased = () => true;
    allowClose = true; caught(() => owner.release());
    assert.equal(calls, 1, 'replaced/false marker cannot bypass original prerequisite before native retry');
    caught(() => lease.release()); assert.equal(calls, 1);
    settled = true; owner.release(); assert.equal(calls, 2);
    assert.equal(failure.cacheOwnershipReleased(), true); lease.release();
  }
  {
    let fail = true, closes = 0;
    finish.push(() => { fail = false; });
    const cache = cacheFor(), db = { close() { closes++; if (fail) return false; } };
    const firstLease = cache.setAndAcquire(first, db), secondLease = cache.acquire(first);
    cache.dispose(); assert.equal(closes, 0);
    const owner = cache.pendingOwners()[0];
    assert.deepEqual(owner.release(), { settled: false, pending: true }); assert.equal(closes, 0);
    firstLease.release(); assert.equal(closes, 0);
    caught(() => secondLease.release()); assert.equal(closes, 1);
    caught(() => cache.dispose()); assert.equal(closes, 1);
    fail = false; owner.release(); assert.equal(closes, 2); cache.dispose();
  }
  {
    const secondary = Object.freeze(new Error('unknown original observation inspection'));
    const primary = Object.freeze(Object.defineProperty(new Error('original close'), 'cacheOwnershipReleased', { get() { throw secondary; } }));
    let calls = 0;
    const cache = cacheFor({ maxEntries: 0 });
    const lease = cache.setAndAcquire(first, { close() { calls++; throw primary; } });
    const failure = caught(() => lease.release()), owner = cache.pendingOwners()[0];
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    caught(() => owner.release()); assert.equal(calls, 1);
    assert.equal(owner.isSettled(), false, 'unknown original observation is retained, not qualified by a copied callback');
  }
} finally {
  for (const complete of finish) complete();
  for (const owner of getPendingSqliteCacheOwners()) if (!baseline.has(owner)) { try { owner.release(); } catch {} }
  for (const cache of caches) { try { cache.dispose(); } catch {} }
  await rmDirRecursive(root);
}
console.log('SQLite original failed-close retention/lease/observer/capability controls authored; execution deferred.');
