#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 1 });
queue.maxPending = 1;

const started = [];
const items = [0, 1, 2];
const err = await runWithQueue(
  queue,
  items,
  async (item) => {
    started.push(item);
    if (item === 0) {
      throw new Error('fail-fast');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return item;
  }
).then(() => null, (error) => error);

assert.ok(err instanceof Error, 'expected rejection');
assert.equal(err.message, 'fail-fast');
assert.deepEqual(started, [0], 'expected hard stop after first failure');

console.log('concurrency backpressure on reject test passed');
