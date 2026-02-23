#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sanitizeRuntimeSnapshotForCheckpoint } from '../../../src/index/build/indexer/pipeline.js';

const snapshot = {
  scheduler: {
    queues: {
      'stage1.cpu': {
        pending: 12,
        running: 3,
        oldestWaitMs: 122,
        lastWaitMs: 18,
        waitP95Ms: 37,
        waitSampleCount: 44
      }
    },
    utilization: { overall: 0.8 }
  },
  cpu: { busyPct: 52.3 },
  memory: { utilization: 0.66 }
};

const sanitized = sanitizeRuntimeSnapshotForCheckpoint(snapshot);
assert.ok(sanitized, 'expected sanitized snapshot');
assert.equal(
  sanitized.scheduler?.queues?.['stage1.cpu']?.pending,
  12,
  'expected queue pending metric to be preserved'
);
assert.equal(
  sanitized.scheduler?.queues?.['stage1.cpu']?.oldestWaitMs,
  undefined,
  'expected volatile oldestWaitMs to be removed'
);
assert.equal(
  sanitized.scheduler?.queues?.['stage1.cpu']?.lastWaitMs,
  undefined,
  'expected volatile lastWaitMs to be removed'
);
assert.equal(
  sanitized.scheduler?.queues?.['stage1.cpu']?.waitP95Ms,
  undefined,
  'expected volatile waitP95Ms to be removed'
);
assert.equal(
  sanitized.scheduler?.queues?.['stage1.cpu']?.waitSampleCount,
  undefined,
  'expected volatile waitSampleCount to be removed'
);
assert.equal(
  snapshot.scheduler?.queues?.['stage1.cpu']?.oldestWaitMs,
  122,
  'expected source snapshot to remain unchanged'
);

console.log('stage checkpoint runtime snapshot sanitize test passed');
