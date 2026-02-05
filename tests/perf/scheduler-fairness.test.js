#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  starvationMs: 1000,
  queues: {
    high: { priority: 10 },
    low: { priority: 90 }
  }
});

const order = [];
let release = null;

const high1 = scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high1');
  await new Promise((resolve) => {
    release = resolve;
  });
});

await sleep(5);
const low1 = scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('low1');
});
const high2 = scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high2');
});

release();
await Promise.all([high1, low1, high2]);

const idxHigh2 = order.indexOf('high2');
const idxLow1 = order.indexOf('low1');
assert.equal(order[0], 'high1');
assert.ok(idxHigh2 !== -1 && idxLow1 !== -1, 'expected both high2 and low1 to run');
assert.ok(idxHigh2 < idxLow1, 'expected high-priority queue to run before low-priority queue');

console.log('scheduler fairness test passed');
