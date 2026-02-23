#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectSchedulerQueuePressure } from '../../../src/shared/concurrency/scheduler-core-queue-pressure.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const queueOrder = [
  {
    pending: [{}, {}],
    pendingBytes: 1024,
    running: 0,
    inFlightBytes: 0,
    floorCpu: 2,
    floorIo: 1,
    floorMem: 1
  },
  {
    pending: [{}],
    pendingBytes: 2048,
    running: 3,
    inFlightBytes: 4096,
    floorCpu: 4,
    floorIo: 2,
    floorMem: 5
  },
  {
    pending: [],
    pendingBytes: 0,
    running: 0,
    inFlightBytes: 0,
    floorCpu: 9,
    floorIo: 9,
    floorMem: 9
  }
];

const summary = collectSchedulerQueuePressure({
  queueOrder,
  normalizeByteCount: (value) => Number(value) || 0
});

assert.equal(summary.totalPending, 3);
assert.equal(summary.totalPendingBytes, 3072);
assert.equal(summary.totalRunning, 3);
assert.equal(summary.totalRunningBytes, 4096);
assert.equal(summary.starvedQueues, 1, 'expected one queue with pending work but zero running items');
assert.equal(summary.floorCpu, 4, 'inactive queues should not influence floor constraints');
assert.equal(summary.floorIo, 2);
assert.equal(summary.floorMem, 5);

console.log('scheduler queue pressure collector test passed');
