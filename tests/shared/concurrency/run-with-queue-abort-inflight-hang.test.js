#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency.js';
import { isAbortError } from '../../../src/shared/abort.js';

const queue = new PQueue({ concurrency: 1 });
const controller = new AbortController();
const items = [1, 2];
let started = 0;

const runPromise = runWithQueue(
  queue,
  items,
  async (item) => {
    started += 1;
    if (item === 1) {
      await new Promise(() => {});
    }
    return item;
  },
  {
    signal: controller.signal
  }
);

setTimeout(() => {
  controller.abort(new Error('abort-test'));
}, 50);

const startedAtMs = Date.now();

try {
  await runPromise;
  assert.fail('expected abort for hung in-flight task');
} catch (err) {
  assert.ok(isAbortError(err), `expected AbortError, got ${err?.name || err}`);
}

const elapsedMs = Date.now() - startedAtMs;
assert.ok(elapsedMs < 1000, `abort should fail fast, took ${elapsedMs}ms`);
assert.equal(started, 1, 'expected only first task to start before abort');

console.log('runWithQueue abort in-flight hang test passed');
