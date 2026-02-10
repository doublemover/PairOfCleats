#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  starvationMs: 15,
  queues: {
    high: { priority: 10 },
    low: { priority: 90 }
  }
});

const order = [];
let release = null;

const high1 = scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('start-high1');
  await new Promise((resolve) => {
    release = resolve;
  });
  order.push('end-high1');
});

await sleep(5);
const low1 = scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('start-low1');
  order.push('end-low1');
});

await sleep(5);
const high2 = scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('start-high2');
  order.push('end-high2');
});

await sleep(25);
release();

await Promise.all([high1, low1, high2]);

const idxLow1 = order.indexOf('start-low1');
const idxHigh2 = order.indexOf('start-high2');
assert.ok(idxLow1 !== -1 && idxHigh2 !== -1, 'expected low1 and high2 to run');
assert.ok(idxLow1 < idxHigh2, 'expected starvation override to schedule low priority before high2');

const stats = scheduler.stats();
assert.ok(stats.counters.starvation >= 1, 'expected starvation counter to increment');

console.log('scheduler starvation test passed');
