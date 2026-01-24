#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../src/shared/concurrency.js';

const unhandled = [];
const onUnhandled = (reason) => {
  unhandled.push(reason);
};
process.on('unhandledRejection', onUnhandled);

const queue = new PQueue({ concurrency: 2 });
const items = [0, 1, 2];
const err = await runWithQueue(
  queue,
  items,
  async (item) => {
    if (item === 1) throw new Error('boom');
    return item;
  }
).then(() => null, (error) => error);

process.removeListener('unhandledRejection', onUnhandled);

assert.ok(err instanceof Error, 'expected rejection');
assert.equal(err.message, 'boom');
assert.equal(unhandled.length, 0, 'unexpected unhandled rejection');

console.log('concurrency error propagation test passed');
