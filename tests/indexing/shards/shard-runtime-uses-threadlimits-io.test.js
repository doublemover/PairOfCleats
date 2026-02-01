#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createShardRuntime } from '../../../src/index/build/indexer/steps/process-files/runtime.js';

const baseRuntime = {
  ioConcurrency: 12,
  cpuConcurrency: 6,
  workerPools: null,
  workerPool: null,
  quantizePool: null,
  envelope: {
    queues: {
      io: { concurrency: 12, maxPending: 48 },
      cpu: { concurrency: 6, maxPending: 24 },
      embedding: { concurrency: 2, maxPending: 8 }
    }
  }
};

const runtime = createShardRuntime(baseRuntime, {
  fileConcurrency: 32,
  importConcurrency: 32,
  embeddingConcurrency: 2
});

assert.strictEqual(runtime.ioConcurrency, 12, 'shard runtime should reuse base ioConcurrency');
assert.strictEqual(runtime.queues.io.concurrency, 12, 'io queue should honor base ioConcurrency');

console.log('shard runtime io concurrency test passed');
