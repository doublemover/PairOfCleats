#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';

let activeTasks = 0;
let poolCreates = 0;
let poolDestroys = 0;
const createdPoolIds = [];

const createPool = () => {
  const id = ++poolCreates;
  createdPoolIds.push(id);
  return {
    id,
    async destroy() {
      poolDestroys += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
};

const lifecycle = createWorkerPoolLifecycle({
  maxRestartAttempts: 3,
  restartBaseDelayMs: 1,
  restartMaxDelayMs: 1,
  configuredMaxWorkers: 2,
  getActiveTasks: () => activeTasks,
  createPool
});

lifecycle.initialize();
assert.equal(poolCreates, 1, 'expected initial pool create');
assert.equal(lifecycle.isDisabled(), false, 'expected lifecycle enabled after initialize');

activeTasks = 1;
await lifecycle.scheduleRestart('synthetic worker failure');
assert.equal(lifecycle.isPendingRestart(), true, 'expected pending restart after scheduleRestart');
assert.equal(lifecycle.isDisabled(), true, 'expected lifecycle disabled while restart is pending');
assert.equal(poolDestroys, 0, 'expected no pool destroy while task is in flight');

await new Promise((resolve) => setTimeout(resolve, 5));
const blockedRestart = await lifecycle.ensurePool();
assert.equal(blockedRestart, false, 'expected ensurePool to block restart while tasks are active');
assert.equal(poolCreates, 1, 'expected no restart create while tasks are active');

activeTasks = 0;
await Promise.all([
  lifecycle.handleTaskDrained(),
  lifecycle.handleTaskDrained(),
  lifecycle.handleTaskDrained()
]);

assert.equal(poolCreates, 2, 'expected one restart create after pool drains');
assert.ok(poolDestroys >= 1, 'expected at least one destroy during drain-triggered restart');
assert.equal(lifecycle.isDisabled(), false, 'expected lifecycle re-enabled after restart');
assert.equal(lifecycle.isPendingRestart(), false, 'expected pending restart cleared after restart');
assert.deepEqual(createdPoolIds, [1, 2], 'expected stable serialized pool create order');

await lifecycle.destroy();
assert.ok(poolDestroys >= 2, 'expected destroy to tear down final pool');

console.log('worker pool lifecycle restart serialization test passed');
