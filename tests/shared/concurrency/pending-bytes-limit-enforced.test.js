#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 2 });
queue.maxPendingBytes = 100;
queue.inflightBytes = 0;

let releaseFirst = null;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
const started = [];

const runPromise = runWithQueue(
  queue,
  [80, 80],
  async (_item, ctx) => {
    started.push(ctx.index);
    if (ctx.index === 0) {
      await firstGate;
    }
    return true;
  },
  {
    collectResults: false,
    estimateBytes: (item) => item
  }
);

await new Promise((resolve) => setTimeout(resolve, 25));

assert.deepEqual(started, [0], 'expected byte cap to block second task dispatch');
assert.equal(queue.inflightBytes, 80, 'expected first task bytes to be tracked');

releaseFirst();
await runPromise;

assert.equal(queue.inflightBytes, 0, 'expected in-flight bytes to return to zero');

console.log('concurrency pending-bytes limit enforced ok');
