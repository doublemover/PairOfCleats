#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSchedulerQueueStatsSnapshot,
  resolveSchedulerUtilization
} from '../../../src/shared/concurrency/scheduler-core-stats.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const queueOrder = [
  {
    name: 'stage1',
    surface: 'cpu',
    pending: [{ enqueuedAt: 1000 }],
    pendingBytes: 128,
    running: 2,
    inFlightBytes: 256,
    maxPending: 10,
    maxPendingBytes: 1024,
    maxInFlightBytes: 4096,
    floorCpu: 1,
    floorIo: 0,
    floorMem: 1,
    priority: 10,
    weight: 2,
    stats: {
      scheduled: 5,
      started: 4,
      completed: 3,
      failed: 1,
      rejected: 0,
      rejectedMaxPending: 0,
      rejectedMaxPendingBytes: 0,
      starvation: 0,
      lastWaitMs: 10,
      waitP95Ms: 25,
      waitSamples: [10, 20, 25]
    }
  },
  {
    name: 'write',
    surface: 'io',
    pending: [],
    pendingBytes: 0,
    running: 1,
    inFlightBytes: 512,
    maxPending: 5,
    maxPendingBytes: 512,
    maxInFlightBytes: 2048,
    floorCpu: 0,
    floorIo: 1,
    floorMem: 0,
    priority: 20,
    weight: 1,
    stats: {
      scheduled: 2,
      started: 2,
      completed: 2,
      failed: 0,
      rejected: 0,
      rejectedMaxPending: 0,
      rejectedMaxPendingBytes: 0,
      starvation: 0,
      lastWaitMs: 2,
      waitP95Ms: 4,
      waitSamples: []
    }
  }
];

const snapshot = buildSchedulerQueueStatsSnapshot({
  queueOrder,
  nowMs: () => 2000,
  normalizeByteCount: (value) => Number(value) || 0
});

assert.equal(snapshot.activity.pending, 1);
assert.equal(snapshot.activity.pendingBytes, 128);
assert.equal(snapshot.activity.running, 3);
assert.equal(snapshot.activity.inFlightBytes, 768);
assert.equal(snapshot.queueStats.stage1.oldestWaitMs, 1000);
assert.equal(snapshot.queueStats.stage1.waitSampleCount, 3);
assert.equal(snapshot.queueStats.write.pending, 0);

assert.equal(resolveSchedulerUtilization(5, 10), 0.5);
assert.equal(resolveSchedulerUtilization(5, 0), 0);
assert.equal(resolveSchedulerUtilization(20, 10), 1);

console.log('scheduler core stats snapshot test passed');
