#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processed = [];
const logs = [];
const appender = buildOrderedAppender(
  async (result) => {
    processed.push(result.id);
  },
  {},
  {
    expectedCount: 3,
    startIndex: 0,
    stallMs: 0,
    log: (message) => logs.push(String(message || ''))
  }
);

const done1 = appender.enqueue(1, { id: 1 });
const done2 = appender.enqueue(2, { id: 2 });

const preRecoveryState = await Promise.race([
  Promise.all([done1, done2]).then(() => 'settled'),
  sleep(20).then(() => 'pending')
]);
assert.equal(
  preRecoveryState,
  'pending',
  'expected higher indices to remain blocked while leading gap exists'
);

const recovery = appender.recoverMissingRange({ reason: 'test_gap' });
assert.equal(recovery.recovered, 1, 'expected gap recovery to skip one missing index');
assert.equal(recovery.start, 0, 'expected recovery to start at first missing index');
assert.equal(recovery.end, 0, 'expected recovery to end at first missing index');

await Promise.all([done1, done2]);
assert.deepEqual(processed, [1, 2], 'expected flush to continue in deterministic order after recovery');
assert.ok(
  logs.some((line) => line.includes('[ordered] recovered missing indices 0-0')),
  'expected recovery log line'
);
assert.equal(appender.snapshot().nextIndex, 3, 'expected ordered cursor to advance past recovered gap');

console.log('ordered appender recover-missing-range test passed');
