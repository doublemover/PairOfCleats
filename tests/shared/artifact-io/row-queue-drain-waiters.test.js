#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRowQueue } from '../../../src/shared/artifact-io/json/row-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = createRowQueue({ maxPending: 1 });
const consumed = [];

const consumer = (async () => {
  for await (const entry of queue.iterator()) {
    consumed.push(entry);
    if (consumed.length >= 3) {
      queue.finish();
      break;
    }
    await sleep(5);
  }
})();

const pushPromises = [
  queue.push('a'),
  queue.push('b'),
  queue.push('c')
];

await Promise.race([
  Promise.all(pushPromises),
  sleep(2000).then(() => {
    throw new Error('timed out waiting for queued push promises to resolve');
  })
]);

await consumer;

assert.deepEqual(consumed, ['a', 'b', 'c']);

console.log('row queue drain waiters test passed');
