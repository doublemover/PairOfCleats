import assert from 'node:assert/strict';
import { planWeightedBatches } from '../../../src/shared/concurrency/weighted-batches.js';
import { planShardBatches } from '../../../src/index/build/shards.js';

assert.equal(planShardBatches, planWeightedBatches, 'legacy shard owner must reuse the extracted helper');
const items = [8, 1, 7, 2, 6, 3].map((weight, id) => Object.freeze({ weight, id }));
Object.freeze(items);
const options = { resolveWeight: item => item.weight, resolveTieBreaker: item => item.id };
const batches = planWeightedBatches(items, 3, options);
assert.deepEqual(batches.flat().map(item => item.id).sort(), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(batches.map(batch => batch.reduce((sum, item) => sum + item.weight, 0)), [9, 9, 9]);
assert.deepEqual(batches, planWeightedBatches(items, 3, options));
assert.deepEqual(planWeightedBatches(items, 1, options), [items]);
assert.deepEqual(planWeightedBatches([], 3), []);
assert.deepEqual(planWeightedBatches(items, 2), [[items[0], items[2], items[4]], [items[1], items[3], items[5]]]);
assert.equal(planWeightedBatches(items, 20, options).flat().length, items.length);
console.log('shared weighted batch extraction preserves shard balancing, fallback, coverage and determinism');

const falsyItems = [0, false, '', null, undefined];
const falsyBatches = planWeightedBatches(falsyItems, 2, { resolveWeight: (_, index) => index + 1 });
const assigned = falsyBatches.flat();
assert.equal(assigned.length, falsyItems.length);
for (const item of falsyItems) assert.equal(assigned.filter(value => value === item).length, 1);
