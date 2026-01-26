#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 2 });
const items = ['a', 'b', 'c', 'd'];
const failures = new Set(['b', 'd']);
const onResult = [];
const onError = [];
let processed = 0;

try {
  await runWithQueue(queue, items, async (item, ctx) => {
    processed += 1;
    if (failures.has(item)) {
      throw new Error(`fail:${item}`);
    }
    return item.toUpperCase();
  }, {
    bestEffort: true,
    onResult: (_result, ctx) => {
      onResult.push(ctx.index);
    },
    onError: (_error, ctx) => {
      onError.push(ctx.index);
    }
  });
  assert.fail('expected AggregateError');
} catch (err) {
  assert.ok(err instanceof AggregateError, 'expected AggregateError for best-effort failures');
  assert.strictEqual(err.errors.length, failures.size, 'AggregateError should include each failure');
}

assert.strictEqual(processed, items.length, 'best-effort should process every item');
assert.strictEqual(onResult.length, items.length - failures.size, 'onResult should fire for successes only');
assert.strictEqual(onError.length, failures.size, 'onError should fire once per failure');

console.log('runWithQueue best-effort test passed');
