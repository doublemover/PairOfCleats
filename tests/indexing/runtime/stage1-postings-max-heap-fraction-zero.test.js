#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveStage1Queues } from '../../../src/index/build/runtime/queues.js';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';
import { resolvePostingsQueueConfig } from '../../../src/index/build/indexer/steps/process-files/planner.js';

const stage1Queues = resolveStage1Queues({
  stage1: {
    postings: {
      maxHeapFraction: 0
    }
  }
});
assert.equal(
  stage1Queues.postings.maxHeapFraction,
  0,
  'expected runtime queue config to preserve maxHeapFraction=0 as an explicit disable'
);

const postingsConfig = resolvePostingsQueueConfig({
  stage1Queues,
  queues: { cpu: { maxPending: 2 } },
  cpuConcurrency: 2,
  memoryPolicy: {}
});
assert.equal(
  postingsConfig.maxHeapFraction,
  0,
  'expected postings planner config to pass through maxHeapFraction=0'
);
assert.equal(
  postingsConfig.reserveTimeoutMs > 0,
  true,
  'expected postings planner config to include finite default reserve timeout'
);

const queue = createPostingsQueue({
  maxPending: 2,
  maxPendingRows: 10,
  maxPendingBytes: 1024,
  maxHeapFraction: 0
});

const first = await queue.reserve({ rows: 1, bytes: 10 });
const second = await queue.reserve({ rows: 1, bytes: 10 });
second.release();
first.release();

const stats = queue.stats();
assert.equal(stats.limits.maxHeapFraction, 0);
assert.equal(
  stats.memory.pressureEvents,
  0,
  'expected heap-pressure throttling to remain disabled when maxHeapFraction=0'
);

console.log('stage1 postings max-heap-fraction zero test passed');
