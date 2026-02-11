#!/usr/bin/env node
import { createBuildScheduler } from '../../../../src/shared/concurrency.js';

const scheduler = createBuildScheduler({
  cpuTokens: 0,
  ioTokens: 0,
  memoryTokens: 0,
  queues: {
    high: { priority: 10 },
    low: { priority: 20 }
  }
});

const order = [];
const tasks = [];
let releaseLow = null;

tasks.push(scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('low-start');
  await new Promise((resolve) => {
    releaseLow = resolve;
  });
  order.push('low-end');
}));

const tokenTotals = scheduler.stats()?.tokens || {};
if (tokenTotals?.cpu?.total !== 1 || tokenTotals?.io?.total !== 1 || tokenTotals?.mem?.total !== 1) {
  console.error('scheduler deterministic test failed: expected zero-token pools to clamp to 1');
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, 5));

tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high-1');
}));

tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high-2');
}));

tasks.push(scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('low-tail');
}));

releaseLow();

await Promise.all(tasks);

const expected = ['low-start', 'low-end', 'high-1', 'high-2', 'low-tail'];
if (order.join(',') !== expected.join(',')) {
  console.error(`scheduler deterministic test failed: expected ${expected.join(',')} got ${order.join(',')}`);
  process.exit(1);
}

console.log('scheduler deterministic test passed');
