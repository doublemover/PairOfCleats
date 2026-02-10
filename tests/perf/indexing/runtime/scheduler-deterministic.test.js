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

tasks.push(scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('low-1');
}));

tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high-1');
}));

tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high-2');
}));

tasks.push(scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('low-2');
}));

scheduler.setLimits({ cpuTokens: 1 });

await Promise.all(tasks);

const expected = ['high-1', 'high-2', 'low-1', 'low-2'];
if (order.join(',') !== expected.join(',')) {
  console.error(`scheduler deterministic test failed: expected ${expected.join(',')} got ${order.join(',')}`);
  process.exit(1);
}

console.log('scheduler deterministic test passed');
