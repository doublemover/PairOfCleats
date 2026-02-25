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
    expectedCount: 4,
    startIndex: 0
  }
);

await Promise.all([
  appender.enqueue(0, { id: 0 }, null),
  appender.skip(1, 100),
  appender.fail(2, 101),
  appender.cancel(3, 102)
]);

const snapshot = appender.snapshot();
assert.equal(snapshot.totalSeqCount, 4, 'expected total seq count to match fixture');
assert.equal(snapshot.terminalCount, 4, 'expected terminal count to include mixed outcomes');
assert.equal(snapshot.committedCount, 4, 'expected committed count to include mixed outcomes');
assert.deepEqual(applied, [0], 'expected apply handler only for terminal success outcomes');
appender.assertCompletion();

console.log('stage1 terminal count integrity test passed');
