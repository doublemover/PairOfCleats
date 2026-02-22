#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBoundedObjectPool } from '../../../src/shared/bounded-object-pool.js';

const pool = createBoundedObjectPool({
  maxSize: 2,
  create: () => ({ value: 0 }),
  reset: (entry) => {
    entry.value = 0;
    return entry;
  }
});

const first = pool.acquire();
const second = pool.acquire();
assert.notEqual(first, second, 'expected pool to allocate distinct objects while empty');

first.value = 11;
second.value = 29;
pool.release(first);
pool.release(second);

const afterReleaseStats = pool.stats();
assert.equal(afterReleaseStats.size, 2, 'expected pool to retain released objects up to maxSize');

const reusedA = pool.acquire();
const reusedB = pool.acquire();
assert.equal(reusedA.value, 0, 'expected pooled objects to be reset before reuse');
assert.equal(reusedB.value, 0, 'expected pooled objects to be reset before reuse');

pool.release(reusedA);
pool.release(reusedB);
pool.release({ value: 99 });

const cappedStats = pool.stats();
assert.equal(cappedStats.size, 2, 'expected pool size to remain bounded at maxSize');
assert.equal(cappedStats.maxSize, 2, 'expected maxSize to be exposed by stats()');

console.log('worker bounded object pool test passed');
