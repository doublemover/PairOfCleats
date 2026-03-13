#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const committed = [];
const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    committed.push(context.orderIndex);
  },
  {},
  {
    expectedCount: 2,
    startIndex: 0
  }
);

appender.noteInFlight(0, 101);
appender.noteInFlight(1, 102);

await Promise.all([
  appender.enqueue(1, { id: 1 }, null),
  appender.enqueue(0, { id: 0 }, null)
]);

assert.deepEqual(committed, [0, 1], 'expected noteInFlight-only terminalization to commit in order');
assert.equal(appender.snapshot().pendingCount, 0, 'expected no pending envelopes after commit');
appender.assertCompletion();

console.log('ordered appender note-inflight without dispatch test passed');
