#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';
import { createRuntimeQueues } from '../../../src/index/build/runtime/workers.js';

const scheduler = createBuildScheduler({
  enabled: true,
  lowResourceMode: false,
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  queues: {
    'stage1.cpu': { priority: 40, weight: 5 },
    'embeddings.compute': { priority: 30, weight: 4 }
  }
});

const runtime = createRuntimeQueues({
  ioConcurrency: 1,
  cpuConcurrency: 1,
  fileConcurrency: 1,
  embeddingConcurrency: 1,
  pendingLimits: null,
  scheduler,
  memoryPolicy: {
    maxGlobalRssMb: 4096,
    reserveRssMb: 512,
    queueHeadroomScale: 1
  }
});

assert.ok(runtime.queues.cpu, 'expected cpu queue');
assert.ok(runtime.queues.embedding, 'expected embedding queue');

const withTimeout = (promise, timeoutMs, message) => {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
};

try {
  const nested = runtime.queues.cpu.add(async () => (
    runtime.queues.embedding.add(async () => 'embedded-ok')
  ));

  const result = await withTimeout(
    nested,
    1500,
    'nested cpu->embedding schedule stalled (deadlock regression)'
  );
  assert.equal(result, 'embedded-ok', 'expected nested embedding work to complete');

  await runtime.queues.embedding.onIdle();
  await runtime.queues.cpu.onIdle();
  console.log('scheduler nested embedding queue no-deadlock test passed');
} finally {
  scheduler.shutdown();
}
