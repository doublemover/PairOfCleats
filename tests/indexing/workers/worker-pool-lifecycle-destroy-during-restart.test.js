#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';

applyTestEnv();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let createCalls = 0;
let destroyCalls = 0;
let activeTasks = 1;
let restartRelease = null;

const lifecycle = createWorkerPoolLifecycle({
  poolLabel: 'destroy-during-restart',
  createPool: () => {
    createCalls += 1;
    const instanceId = createCalls;
    return {
      async destroy() {
        destroyCalls += 1;
        if (instanceId === 1) {
          await new Promise((resolve) => {
            restartRelease = resolve;
          });
        }
      }
    };
  },
  getActiveTasks: () => activeTasks,
  log: () => {}
});

lifecycle.initialize();
await lifecycle.scheduleRestart('synthetic restart');
activeTasks = 0;
const ensurePromise = lifecycle.handleTaskDrained();
await sleep(10);
const destroyPromise = lifecycle.destroy();
assert.ok(restartRelease, 'expected restart destroy to be waiting');
restartRelease();
await Promise.all([ensurePromise, destroyPromise]);

assert.equal(createCalls, 1, 'expected destroy to prevent replacement pool creation during restart');
assert.equal(destroyCalls, 1, 'expected original pool to be destroyed exactly once');
assert.equal(lifecycle.getPool(), null, 'expected pool reference to remain cleared after destroy');

console.log('worker pool lifecycle destroy-during-restart test passed');
