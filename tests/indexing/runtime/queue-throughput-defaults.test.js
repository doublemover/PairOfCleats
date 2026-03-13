#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRuntimeQueues } from '../../../src/index/build/runtime/workers.js';

const runtime = createRuntimeQueues({
  ioConcurrency: 8,
  cpuConcurrency: 8,
  fileConcurrency: 8,
  embeddingConcurrency: null,
  pendingLimits: null,
  scheduler: null,
  memoryPolicy: {
    maxGlobalRssMb: 16384,
    reserveRssMb: 1024,
    queueHeadroomScale: 4
  }
});

assert.equal(runtime.maxFilePending, 384, 'expected throughput-first cpu pending default');
assert.equal(runtime.maxIoPending, 192, 'expected throughput-first io pending default');
assert.equal(runtime.maxEmbeddingPending, 384, 'expected throughput-first embedding pending default');
assert.equal(runtime.queues.cpu.maxPending, 384, 'expected cpu queue max pending passthrough');
assert.equal(runtime.queues.io.maxPending, 192, 'expected io queue max pending passthrough');
assert.equal(runtime.queues.embedding.maxPending, 384, 'expected embedding queue max pending passthrough');
assert.ok(
  Number.isFinite(runtime.queues.cpu.maxPendingBytes) && runtime.queues.cpu.maxPendingBytes >= (96 * 1024 * 1024),
  'expected larger throughput-first cpu pending byte budget'
);
assert.ok(
  Number.isFinite(runtime.queues.embedding.maxPendingBytes)
    && runtime.queues.embedding.maxPendingBytes >= (48 * 1024 * 1024),
  'expected larger throughput-first embedding pending byte budget'
);

console.log('runtime queue throughput defaults test passed');
