#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const committed = [];
const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    committed.push(context.orderIndex);
  },
  {},
  {
    expectedCount: 3,
    startIndex: 0
  }
);

assert.equal(
  typeof appender.recoverMissingRange,
  'undefined',
  'expected no recover-missing-range correctness branch on hard-cutover appender'
);

const done1 = appender.enqueue(1, { id: 1 }, null).catch(() => {});
const done2 = appender.enqueue(2, { id: 2 }, null).catch(() => {});
const blockedState = await Promise.race([
  Promise.all([done1, done2]).then(() => 'settled'),
  sleep(20).then(() => 'pending')
]);
assert.equal(blockedState, 'pending', 'expected higher seq values to remain blocked while seq 0 is missing');

appender.abort(new Error('test cleanup'));
await Promise.all([done1, done2]);
assert.deepEqual(committed, [], 'expected no commits while head seq remains non-terminal');

console.log('stage1 no-gap-recovery correctness test passed');
