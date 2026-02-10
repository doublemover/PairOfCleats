#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';

applyTestEnv();

const events = [];
let resolveDrain = null;
const workerDrain = new Promise((resolve) => {
  resolveDrain = resolve;
});

const registry = createLifecycleRegistry({ name: 'shutdown-drain-contract' });
registry.registerWorker({}, {
  label: 'worker',
  close: () => {
    events.push('close');
  },
  drain: async () => {
    events.push('drain:start');
    await workerDrain;
    events.push('drain:done');
  }
});

let taskResolved = false;
registry.registerPromise(new Promise((resolve) => {
  setTimeout(() => {
    taskResolved = true;
    events.push('task:done');
    resolve();
  }, 20);
}), { label: 'pending-task' });

setTimeout(() => {
  resolveDrain();
}, 30);

await registry.close();

assert.equal(taskResolved, true, 'expected pending task to resolve during close/drain');
assert.equal(events.includes('close'), true, 'expected worker close to run');
assert.equal(events.includes('drain:start'), true, 'expected worker drain to run');
assert.equal(events.includes('drain:done'), true, 'expected worker drain to complete');
assert.ok(events.indexOf('close') < events.indexOf('drain:start'), 'expected close before drain');
assert.equal(registry.pendingCount(), 0, 'expected lifecycle pending count to be zero');

console.log('shutdown drain contract test passed');
