#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 3 });
queue.maxPending = 0;

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

assert.equal(started, 3, 'expected maxPending=0 to disable pending gating');

gateResolve();
await Promise.race([
  runPromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('runWithQueue stalled with maxPending=0')), 1500))
]);

console.log('concurrency pending limit zero-disable test passed');
