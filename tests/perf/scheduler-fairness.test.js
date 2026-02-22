#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../src/shared/concurrency.js';
import { treeSitterSchedulerPlannerInternals } from '../../src/index/build/tree-sitter-scheduler/plan.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  starvationMs: 1000,
  queues: {
    high: { priority: 10 },
    low: { priority: 90 }
  }
});

const order = [];
let release = null;

const high1 = scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high1');
  await new Promise((resolve) => {
    release = resolve;
  });
});

await sleep(5);
const low1 = scheduler.schedule('low', { cpu: 1 }, async () => {
  order.push('low1');
});
const high2 = scheduler.schedule('high', { cpu: 1 }, async () => {
  order.push('high2');
});

release();
await Promise.all([high1, low1, high2]);

const idxHigh2 = order.indexOf('high2');
const idxLow1 = order.indexOf('low1');
assert.equal(order[0], 'high1');
assert.ok(idxHigh2 !== -1 && idxLow1 !== -1, 'expected both high2 and low1 to run');
assert.ok(idxHigh2 < idxLow1, 'expected high-priority queue to run before low-priority queue');

const { assignPathAwareBuckets, summarizeBucketMetrics } = treeSitterSchedulerPlannerInternals;
const skewedJobs = [];
for (let i = 0; i < 120; i += 1) {
  const isExpensive = i < 60;
  skewedJobs.push({
    languageId: 'ruby',
    containerPath: isExpensive
      ? `app/models/heavy-${i}.rb`
      : `app/services/light-${i}.rb`,
    virtualPath: `app/file-${i}.rb`,
    estimatedParseCost: isExpensive ? 220 + ((i % 5) * 7) : 22 + (i % 4)
  });
}

const laneCount = 6;
const naiveBuckets = Array.from({ length: laneCount }, () => []);
const naiveChunkSize = Math.ceil(skewedJobs.length / laneCount);
for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
  const start = laneIndex * naiveChunkSize;
  const end = Math.min(start + naiveChunkSize, skewedJobs.length);
  naiveBuckets[laneIndex].push(...skewedJobs.slice(start, end));
}
const naiveMetrics = summarizeBucketMetrics(naiveBuckets);
const weightedBuckets = assignPathAwareBuckets({ jobs: skewedJobs, bucketCount: laneCount });
const weightedMetrics = summarizeBucketMetrics(weightedBuckets);
assert.ok(
  weightedMetrics.cost.spreadRatio < naiveMetrics.cost.spreadRatio,
  `expected weighted lane spread ratio ${weightedMetrics.cost.spreadRatio} to beat naive ${naiveMetrics.cost.spreadRatio}`
);
assert.ok(
  weightedMetrics.cost.imbalanceRatio < naiveMetrics.cost.imbalanceRatio,
  `expected weighted lane imbalance ratio ${weightedMetrics.cost.imbalanceRatio} to beat naive ${naiveMetrics.cost.imbalanceRatio}`
);

console.log('scheduler fairness test passed');
