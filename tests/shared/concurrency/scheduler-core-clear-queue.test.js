#!/usr/bin/env node
import assert from 'node:assert/strict';

import { clearSchedulerQueuePending } from '../../../src/shared/concurrency/scheduler-core-clear-queue.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const rejectedMessages = [];
const queue = {
  pending: [
    {
      bytes: 100,
      reject: (error) => rejectedMessages.push(error.message)
    },
    {
      bytes: 50,
      reject: (error) => rejectedMessages.push(error.message)
    }
  ],
  pendingBytes: 150,
  pendingSearchCursor: 9,
  stats: {
    rejected: 3
  }
};
const counters = {
  rejected: 10,
  rejectedByReason: {
    cleared: 2
  }
};

const clearedCount = clearSchedulerQueuePending({
  queue,
  reason: 'manual clear',
  normalizeByteCount: (value) => Number(value) || 0,
  counters
});

assert.equal(clearedCount, 2);
assert.equal(queue.pending.length, 0);
assert.equal(queue.pendingBytes, 0);
assert.equal(queue.pendingSearchCursor, 0);
assert.equal(queue.stats.rejected, 5);
assert.equal(counters.rejected, 12);
assert.equal(counters.rejectedByReason.cleared, 4);
assert.deepEqual(rejectedMessages, ['manual clear', 'manual clear']);

const noOp = clearSchedulerQueuePending({
  queue: null,
  reason: 'unused',
  normalizeByteCount: (value) => Number(value) || 0,
  counters
});
assert.equal(noOp, 0);

console.log('scheduler core clear queue helper test passed');
