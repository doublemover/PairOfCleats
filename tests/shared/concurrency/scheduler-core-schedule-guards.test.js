#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveSchedulerScheduleRejection } from '../../../src/shared/concurrency/scheduler-core-schedule-guards.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const createCounters = () => ({
  scheduled: 0,
  rejected: 0,
  rejectedByReason: {
    maxPending: 0,
    maxPendingBytes: 0
  }
});

const pendingQueue = {
  pending: [{ enqueuedAt: 1 }],
  pendingBytes: 50,
  maxPending: 1,
  maxPendingBytes: 0,
  stats: {
    rejected: 0,
    rejectedMaxPending: 0,
    rejectedMaxPendingBytes: 0,
    scheduled: 0
  }
};
const pendingCounters = createCounters();
const pendingRejection = resolveSchedulerScheduleRejection({
  queueName: 'stage1',
  queue: pendingQueue,
  normalizedReq: { bytes: 10 },
  normalizeByteCount: (value) => Number(value) || 0,
  counters: pendingCounters
});
assert.equal(pendingRejection?.message, 'queue stage1 is at maxPending');
assert.equal(pendingQueue.stats.rejected, 1);
assert.equal(pendingQueue.stats.rejectedMaxPending, 1);
assert.equal(pendingQueue.stats.scheduled, 1);
assert.equal(pendingCounters.scheduled, 1);
assert.equal(pendingCounters.rejected, 1);
assert.equal(pendingCounters.rejectedByReason.maxPending, 1);

const bytesQueue = {
  pending: [{ enqueuedAt: 1 }],
  pendingBytes: 100,
  maxPending: 0,
  maxPendingBytes: 120,
  stats: {
    rejected: 0,
    rejectedMaxPending: 0,
    rejectedMaxPendingBytes: 0,
    scheduled: 0
  }
};
const bytesCounters = createCounters();
const bytesRejection = resolveSchedulerScheduleRejection({
  queueName: 'stage2-write',
  queue: bytesQueue,
  normalizedReq: { bytes: 30 },
  normalizeByteCount: (value) => Number(value) || 0,
  counters: bytesCounters
});
assert.equal(bytesRejection?.message, 'queue stage2-write is at maxPendingBytes');
assert.equal(bytesQueue.stats.rejected, 1);
assert.equal(bytesQueue.stats.rejectedMaxPendingBytes, 1);
assert.equal(bytesCounters.rejectedByReason.maxPendingBytes, 1);

const oversizeSingleQueue = {
  pending: [],
  pendingBytes: 0,
  maxPending: 0,
  maxPendingBytes: 120,
  stats: {
    rejected: 0,
    rejectedMaxPending: 0,
    rejectedMaxPendingBytes: 0,
    scheduled: 0
  }
};
const oversizeCounters = createCounters();
const oversizeRejection = resolveSchedulerScheduleRejection({
  queueName: 'stage2-write',
  queue: oversizeSingleQueue,
  normalizedReq: { bytes: 400 },
  normalizeByteCount: (value) => Number(value) || 0,
  counters: oversizeCounters
});
assert.equal(oversizeRejection, null);
assert.equal(oversizeCounters.rejected, 0);

console.log('scheduler core schedule guard helper test passed');
