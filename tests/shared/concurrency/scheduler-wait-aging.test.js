#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  starvationMs: 60_000
});
scheduler.registerQueue('high', { priority: 20, weight: 1 });
scheduler.registerQueue('low', { priority: 50, weight: 1 });

for (let i = 0; i < 4; i += 1) {
  await scheduler.schedule('low', { cpu: 1 }, async () => {
    await sleep(3);
    return `prewarm-${i}`;
  });
}

const executionOrder = [];
const tasks = [];
tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
  await sleep(45);
  executionOrder.push('high-0');
}));
tasks.push(scheduler.schedule('low', { cpu: 1 }, async () => {
  executionOrder.push('low-aged');
}));
for (let i = 1; i <= 6; i += 1) {
  tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
    await sleep(20);
    executionOrder.push(`high-${i}`);
  }));
}
await Promise.all(tasks);

const lowIndex = executionOrder.indexOf('low-aged');
assert.ok(lowIndex >= 0, 'expected low queue task to execute');
assert.ok(
  lowIndex < (executionOrder.length - 1),
  'expected wait-time aging to prevent low queue task from running last'
);

const stats = scheduler.stats();
const lowStats = stats?.queues?.low;
assert.ok(lowStats, 'expected low queue stats');
assert.ok(lowStats.waitSampleCount > 0, 'expected wait-time samples for low queue');
assert.ok(lowStats.waitP95Ms >= lowStats.lastWaitMs || lowStats.waitP95Ms >= 0, 'expected wait p95 metric');

scheduler.shutdown();
console.log('scheduler wait aging test passed');
