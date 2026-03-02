#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency.js';
import { isAbortError } from '../../../src/shared/abort.js';

const withTimeout = async (promise, timeoutMs, label) => (
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ])
);

const runAbortDuringBackpressureScenario = async ({
  label,
  configureQueue,
  items
}) => {
  const queue = new PQueue({ concurrency: 1 });
  configureQueue(queue);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);

  try {
    await withTimeout(
      runWithQueue(
        queue,
        items,
        async (item) => {
          if (item?.hang) {
            await new Promise(() => {});
          }
          return true;
        },
        { signal: controller.signal }
      ),
      2000,
      label
    );
    assert.fail(`${label}: expected abort`);
  } catch (error) {
    assert.ok(isAbortError(error), `${label}: expected AbortError, got ${error?.name || error}`);
  }
};

await runAbortDuringBackpressureScenario({
  label: 'maxPending backpressure wait',
  configureQueue(queue) {
    queue.maxPending = 1;
  },
  items: [{ hang: true }, { hang: false }]
});

await runAbortDuringBackpressureScenario({
  label: 'maxPendingBytes backpressure wait',
  configureQueue(queue) {
    queue.maxPendingBytes = 1;
  },
  items: [{ hang: true, bytes: 1 }, { hang: false, bytes: 1 }]
});

console.log('runWithQueue backpressure abort test passed');
