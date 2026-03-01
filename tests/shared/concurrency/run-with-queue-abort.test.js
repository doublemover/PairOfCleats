#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency.js';
import { isAbortError } from '../../../src/shared/abort.js';

const queue = new PQueue({ concurrency: 1 });
const controller = new AbortController();
const items = [1, 2, 3, 4, 5];

setTimeout(() => controller.abort(), 30);

try {
  await runWithQueue(queue, items, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  }, {
    signal: controller.signal
  });
  assert.fail('expected abort');
} catch (err) {
  assert.ok(isAbortError(err), `expected AbortError, got ${err?.name || err}`);
}

console.log('runWithQueue abort test passed');
