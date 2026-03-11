#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';

applyTestEnv();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let activeTasks = 1;
let destroyCalls = 0;
const lifecycle = createWorkerPoolLifecycle({
  poolLabel: 'destroy-contract',
  createPool: () => ({
    async destroy() {
      destroyCalls += 1;
      await sleep(10);
    }
  }),
  getActiveTasks: () => activeTasks,
  log: () => {}
});

lifecycle.initialize();

const firstDestroy = lifecycle.destroy();
const secondDestroy = lifecycle.destroy();

await sleep(20);
assert.equal(destroyCalls, 0, 'expected destroy to wait for active worker tasks to drain');

activeTasks = 0;
await lifecycle.handleTaskDrained();
await Promise.all([firstDestroy, secondDestroy]);

assert.equal(destroyCalls, 1, 'expected worker pool destroy to be serialized and idempotent');
assert.equal(lifecycle.getPool(), null, 'expected pool reference to clear after destroy');

console.log('worker pool lifecycle destroy test passed');
