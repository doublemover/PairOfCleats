#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 1 });
queue.maxPending = 1;

const items = ['a', 'b', 'c', 'd'];
const processed = [];
const errors = [];

try {
  await runWithQueue(
    queue,
    items,
    async (item) => {
      processed.push(item);
      if (item === 'b') throw new Error('boom');
      return item;
    },
    {
      onError: (_err, ctx) => {
        errors.push(ctx.item);
      }
    }
  );
  assert.fail('expected failure');
} catch (err) {
  assert.match(String(err?.message || ''), /boom/, 'expected first error to propagate');
}

assert.deepStrictEqual(processed, ['a', 'b'], 'fail-fast should stop scheduling after first error');
assert.deepStrictEqual(errors, ['b'], 'onError should fire once for the failing item');

console.log('runWithQueue fail-fast test passed');
