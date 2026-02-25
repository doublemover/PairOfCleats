#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1
});

scheduler.registerQueue('maxpending-clear', { priority: 10, maxPending: 1 });
scheduler.registerQueue('maxpending-clear', { maxPending: 0 });

let releaseFirst = null;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});

const first = scheduler.schedule('maxpending-clear', { cpu: 1 }, async () => {
  await firstGate;
  return 'first';
});
const second = scheduler.schedule('maxpending-clear', { cpu: 1 }, async () => 'second');
const third = scheduler.schedule('maxpending-clear', { cpu: 1 }, async () => 'third');

await sleep(20);

const midStats = scheduler.stats();
assert.equal(
  midStats?.queues?.['maxpending-clear']?.pending,
  2,
  'expected maxPending=0 queue re-registration to clear prior pending cap'
);
assert.equal(
  midStats?.queues?.['maxpending-clear']?.maxPending,
  null,
  'expected queue maxPending to be cleared when set to zero'
);

releaseFirst();
await Promise.all([first, second, third]);

const finalStats = scheduler.stats();
assert.equal(
  finalStats?.counters?.rejectedByReason?.maxPending,
  0,
  'expected no maxPending rejections after clearing queue cap'
);

scheduler.shutdown();

console.log('scheduler maxPending zero clears cap test passed');
