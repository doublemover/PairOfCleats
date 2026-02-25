#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const applied = [];
const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    applied.push(context.orderIndex);
  },
  {},
  {
    expectedCount: 6,
    startIndex: 0
  }
);

await Promise.all([
  appender.enqueue(0, { id: 0 }, null),
  appender.enqueue(1, { id: 1 }, null),
  appender.enqueue(2, { id: 2 }, null),
  appender.enqueue(3, { id: 3 }, null),
  appender.enqueue(4, { id: 4 }, null),
  appender.enqueue(5, { id: 5 }, null)
]);

const commitSeqs = appender
  .journal()
  .filter((record) => record.recordType === 'commit')
  .map((record) => record.seq);

assert.deepEqual(
  commitSeqs,
  [0, 1, 2, 3, 4, 5],
  'expected contiguous commit run coalescing across full-success batch'
);
assert.deepEqual(applied, [0, 1, 2, 3, 4, 5], 'expected apply callback sequence to match commit cursor ordering');
appender.assertCompletion();

console.log('stage1 commit microbatch coalescing test passed');
