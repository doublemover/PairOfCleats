#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const registry = createLifecycleRegistry({ name: 'lifecycle-contract' });

let ticks = 0;
const interval = setInterval(() => {
  ticks += 1;
}, 5);
registry.registerTimer(interval, { label: 'contract-interval' });

let cleanupCalls = 0;
registry.registerCleanup(() => {
  cleanupCalls += 1;
}, { label: 'contract-cleanup' });

let resolved = false;
registry.registerPromise((async () => {
  await sleep(20);
  resolved = true;
})(), { label: 'contract-promise' });

await registry.drain();
assert.equal(resolved, true, 'expected drain to wait for registered promises');

await sleep(20);
const beforeCloseTicks = ticks;
await registry.close();
await sleep(20);
assert.equal(ticks, beforeCloseTicks, 'expected registered timers to stop after close');
assert.equal(cleanupCalls, 1, 'expected cleanup hook to run once');

let registerAfterCloseError = null;
try {
  registry.registerCleanup(() => {}, { label: 'after-close' });
} catch (err) {
  registerAfterCloseError = err;
}
assert.ok(registerAfterCloseError, 'expected register after close to throw');

const workerRegistry = createLifecycleRegistry({ name: 'worker-contract' });
let terminated = false;
workerRegistry.registerWorker({
  terminate: async () => {
    terminated = true;
  }
}, { label: 'worker' });
await workerRegistry.close();
assert.equal(terminated, true, 'expected registerWorker to terminate worker during close');

console.log('lifecycle registry contract ok.');

