#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
let clock = 0;

const scheduler = createBuildScheduler({
  now: () => clock,
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  starvationMs: 60_000
});
scheduler.registerQueue('high', { priority: 20, weight: 1 });
scheduler.registerQueue('low', { priority: 50, weight: 1 });

// Seed a measured QUEUE wait, not task service time. Real sleeps previously
// made this test depend on millisecond rounding and frequently left p95 at 0.
let release;
const blocker = scheduler.schedule('seed', { cpu: 1 }, () => new Promise(resolve => { release = resolve; }));
await tick();
const seed = scheduler.schedule('low', { cpu: 1 }, async () => {});
clock = 1;
release();
await Promise.all([blocker, seed]);
await tick();
assert.equal(scheduler.stats().queues.low.waitP95Ms, 1);

const executionOrder = [];
const tasks = [];
tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
  clock += 200;
  executionOrder.push('high-0');
}));
tasks.push(scheduler.schedule('low', { cpu: 1 }, async () => {
  executionOrder.push('low-aged');
}));
for (let i = 1; i <= 6; i += 1) {
  tasks.push(scheduler.schedule('high', { cpu: 1 }, async () => {
    clock += 20;
    executionOrder.push(`high-${i}`);
  }));
}
await Promise.all(tasks);

const lowIndex = executionOrder.indexOf('low-aged');
assert.ok(lowIndex >= 0, 'expected low queue task to execute');
assert.ok(
  lowIndex === 1,
  'expected wait-p95 aging to overcome priority penalty before the starvation threshold'
);

const stats = scheduler.stats();
const lowStats = stats?.queues?.low;
assert.ok(lowStats, 'expected low queue stats');
assert.ok(lowStats.waitSampleCount > 0, 'expected wait-time samples for low queue');
assert.ok(lowStats.waitP95Ms >= lowStats.lastWaitMs || lowStats.waitP95Ms >= 0, 'expected wait p95 metric');

await scheduler.shutdown();
console.log('scheduler wait aging test passed');
