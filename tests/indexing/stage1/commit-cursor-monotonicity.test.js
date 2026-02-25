#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const expectedCount = 24;
const expectedSeqs = Array.from({ length: expectedCount }, (_unused, index) => index);
const dispatchOrder = expectedSeqs
  .slice()
  .sort((a, b) => ((a * 17) % expectedCount) - ((b * 17) % expectedCount));

const committedOrder = [];
const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    committedOrder.push(context.orderIndex);
  },
  {},
  {
    expectedCount,
    startIndex: 0,
    maxPendingBeforeBackpressure: 4
  }
);

await Promise.all(dispatchOrder.map((seq) => appender.enqueue(seq, { id: seq }, null)));

assert.deepEqual(committedOrder, expectedSeqs, 'expected commit cursor to flush strictly in seq order');
assert.equal(appender.snapshot().nextCommitSeq, expectedCount, 'expected cursor advance by exactly one per seq');
appender.assertCompletion();

console.log('stage1 commit cursor monotonicity test passed');
