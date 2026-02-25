#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processed = [];

const appender = buildOrderedAppender(
  async (result) => {
    processed.push(result.id);
  },
  {},
  {
    expectedCount: 2,
    startIndex: 0
  }
);

await appender.enqueue(0, { id: 0 });
await appender.enqueue(1, { id: 1 });
const lateReplay = appender.enqueue(0, { id: 'late-0' });
const lateReplayState = await Promise.race([
  lateReplay.then(() => 'resolved', () => 'rejected'),
  sleep(20).then(() => 'pending')
]);
assert.equal(
  lateReplayState,
  'pending',
  'expected stale replay enqueue to remain unresolved once cursor has advanced past the seq'
);
appender.abort(new Error('test cleanup'));
await assert.rejects(
  lateReplay,
  (error) => (error?.message || '').includes('test cleanup'),
  'expected stale replay to reject after appender abort'
);

assert.deepEqual(processed, [0, 1], 'stale result should not be appended once index advanced');

console.log('ordered appender stale-drop test passed');
