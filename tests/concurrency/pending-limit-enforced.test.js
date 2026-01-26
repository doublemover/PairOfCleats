#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 1 });
queue.maxPending = 1;

let started = 0;
let gateResolve;
const gate = new Promise((resolve) => {
  gateResolve = resolve;
});

const worker = async () => {
  started += 1;
  await gate;
  return true;
};

const runPromise = runWithQueue(queue, [1, 2, 3], worker, { collectResults: false });

await new Promise((resolve) => setTimeout(resolve, 25));

assert.equal(started, 1, 'expected only one task to start before pending slot frees');
assert.equal(queue.pending, 1, 'expected one running task');
assert.equal(queue.size, 0, 'expected no queued tasks with pending limit enforced');

gateResolve();
await runPromise;

console.log('concurrency pending limit enforced ok');
