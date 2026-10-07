#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFifoBudgetMemo } from '../../../src/shared/cache/fifo-budget.js';
import { buildCacheKey, buildLocalCacheKey, createLocalCacheKeyBuilder } from '../../../src/shared/cache-key.js';

// Small weighted values isolate FIFO, replacement, deletion and both limits.
const memo = createFifoBudgetMemo({ maxEntries: 2, maxBytes: 6,
  sizeCalculation: (value) => typeof value === 'string' ? value.length : NaN });
assert.equal(memo.set('a', 'aa'), true);
memo.set('b', 'bb');
assert.equal(memo.get('a'), 'aa');
memo.set('c', 'cc');
assert.deepEqual([...memo.keys()], ['b', 'c'], 'reads do not refresh FIFO order');
assert.equal(memo.retainedBytes, 4);
memo.set('b', 'bbbb');
assert.deepEqual([...memo.keys()], ['b', 'c'], 'replacement retains its original FIFO position');
assert.equal(memo.retainedBytes, 6);
memo.set('d', 'dd');
assert.deepEqual([...memo.keys()], ['c', 'd']);
assert.equal(memo.retainedBytes, 4);
assert.equal(memo.delete('c'), true);
assert.equal(memo.delete('missing'), false);
assert.equal(memo.retainedBytes, 2);
assert.equal(memo.set('d', 'oversized'), false);
assert.equal(memo.has('d'), false, 'oversized replacement retires the old memo value');
assert.equal(memo.set('invalid', Symbol('invalid')), false);
memo.set('a', 'aa');
memo.clear();
assert.equal(memo.size, 0);
assert.equal(memo.retainedBytes, 0);
for (const limits of [{ maxEntries: 0, maxBytes: 6 }, { maxEntries: 2, maxBytes: 0 }]) {
  const disabled = createFifoBudgetMemo({ ...limits, sizeCalculation: () => 1 });
  assert.equal(disabled.set('a', 'a'), false);
  assert.equal(disabled.size, 0);
}
const zeroSize = createFifoBudgetMemo({ maxEntries: 2, maxBytes: 6, sizeCalculation: () => 0 });
for (const key of ['a', 'b', 'c']) zeroSize.set(key, key);
assert.deepEqual([...zeroSize.keys()], ['b', 'c'], 'entry limits still apply independently');
const throwingSize = createFifoBudgetMemo({ maxEntries: 2, maxBytes: 6,
  sizeCalculation: () => { throw new Error('controlled sizing failure'); } });
assert.equal(throwingSize.set('a', 'a'), false, 'unavailable sizing keeps computation outside the memo');

const marker = 'memo-global-budget';
const observedMaps = new Set();
const originalSet = Map.prototype.set;
let oversizedAdmissions = 0;
let digestMap;
const exactDigest = (result) => {
  assert.equal(result.digest, crypto.createHash('sha1').update(result.serialized).digest('hex'));
  assert.ok(result.key.endsWith(`:${result.digest}`));
};
try {
  Map.prototype.set = function (key, value) {
    if (typeof key === 'string' && key.includes(marker)) {
      observedMaps.add(this);
      if (key.includes(`${marker}-oversized`)) oversizedAdmissions += 1;
    }
    return originalSet.call(this, key, value);
  };
  const oversized = buildLocalCacheKey({ namespace: `${marker}-oversized`,
    payload: { query: 'x'.repeat(4 * 1024 * 1024 + 256) } });
  exactDigest(oversized);
  assert.equal(oversizedAdmissions, 0, 'over-budget strings are returned exactly without either memo retaining them');

  const inputs = ['a', 'b', 'c'].map((char) => ({ namespace: marker,
    payload: { query: char.repeat(1600000) } }));
  const first = buildLocalCacheKey(inputs[0]);
  const second = buildLocalCacheKey(inputs[1]);
  exactDigest(first);
  exactDigest(second);
  assert.equal(buildLocalCacheKey(inputs[0]).key, first.key, 'recomputation/warm digest output is exact');
  const third = buildLocalCacheKey(inputs[2]);
  exactDigest(third);
  assert.equal(observedMaps.size, 2, 'actual global memo owners are exercised');
  digestMap = [...observedMaps].find((entry) => typeof entry.values().next().value === 'string');
  assert.ok(digestMap);
  assert.equal(digestMap.has(first.serialized), false, 'recent reads do not change the existing digest FIFO policy');
  assert.equal(digestMap.has(second.serialized), true);
  assert.equal(digestMap.has(third.serialized), true);

  for (const payload of [null, undefined, 5, NaN, Infinity, { flag: false, omitted: undefined },
    [1, undefined, { z: 2, a: 1 }], { value: 1n }]) {
    const result = buildLocalCacheKey({ namespace: marker, payload });
    exactDigest(result);
    assert.equal(buildLocalCacheKey({ namespace: marker, payload }).key, result.key);
  }
  const legacy = buildCacheKey({ namespace: marker, extra: `${marker}:${'x'.repeat(4 * 1024 * 1024)}` });
  exactDigest(legacy);
  assert.equal(digestMap.has(legacy.serialized), false, 'legacy key output retains the same oversized miss fallback');
} finally {
  Map.prototype.set = originalSet;
}

// Independently account the strings and declared reference slots in actual Maps.
let aggregateProxy = 0;
for (const entries of observedMaps) {
  let bytes = 0;
  for (const [key, value] of entries) {
    bytes += key.length * 2 + 16;
    if (typeof value === 'string') bytes += value.length * 2;
    else for (const leaf of Object.values(value)) bytes += leaf.length * 2 + 8;
  }
  assert.ok(bytes <= 8 * 1024 * 1024, 'each actual global memo stays within8MiB proxy');
  assert.ok(entries.size <= 65536);
  aggregateProxy += bytes;
}
assert.ok(aggregateProxy <= 16 * 1024 * 1024);
const builder = createLocalCacheKeyBuilder({ namespace: marker });
assert.equal(builder.keyForProperty('id', 42), buildLocalCacheKey({ namespace: marker, payload: { id: 42 } }).key);
console.log('Cache-key string budgets passed: two actual globals<=16MiB aggregate proxy; exact digests, FIFO, replacement/miss and inactive-builder compatibility');
