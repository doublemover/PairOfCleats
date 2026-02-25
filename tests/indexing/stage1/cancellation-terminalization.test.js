#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const processed = [];
const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    processed.push(context.orderIndex);
  },
  {},
  {
    expectedCount: 5,
    startIndex: 0
  }
);

await Promise.all([
  appender.enqueue(0, { id: 0 }, null),
  appender.cancel(1, 920),
  appender.cancel(2, 920),
  appender.cancel(3, 920),
  appender.cancel(4, 920)
]);

assert.deepEqual(processed, [0], 'expected cancel terminalization to skip apply path for cancelled seq values');
const snapshot = appender.snapshot();
assert.equal(snapshot.terminalCount, 5, 'expected full terminalization after cancellation sweep');
assert.equal(snapshot.committedCount, 5, 'expected commit lane drain after cancellation sweep');

const cancelTerminals = appender
  .journal()
  .filter((record) => record.recordType === 'terminal' && record.terminalOutcome === 'cancel')
  .map((record) => record.seq)
  .sort((a, b) => a - b);
assert.deepEqual(cancelTerminals, [1, 2, 3, 4], 'expected terminal cancel outcomes per cancelled seq');
appender.assertCompletion();

console.log('stage1 cancellation terminalization test passed');
