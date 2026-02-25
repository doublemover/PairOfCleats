#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let releaseBlockedWrite = null;
const blockedWrite = new Promise((resolve) => {
  releaseBlockedWrite = resolve;
});
let callbackContext = null;

const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    callbackContext = context;
    return blockedWrite;
  },
  {},
  {
    expectedCount: 1,
    startIndex: 0,
    flushTimeoutMs: 35,
    stallMs: 0
  }
);

const completion = appender.enqueue(0, { id: 0 });
await sleep(10);
const activeSnapshot = appender.snapshot();
assert.equal(activeSnapshot.flushActive?.orderIndex, 0, 'expected active flush order index to be tracked');
assert.equal(callbackContext?.orderIndex, 0, 'expected callback context to include ordered index');
assert.equal(callbackContext?.phase, 'ordered_commit', 'expected callback context to include ordered commit phase');
assert.ok(
  Number.isFinite(Number(activeSnapshot.flushActive?.elapsedMs)),
  'expected active flush elapsedMs telemetry'
);

await assert.rejects(
  completion,
  (error) => (
    error
    && error.code === 'ORDERED_FLUSH_TIMEOUT'
    && error.meta?.orderIndex === 0
    && Number(error.meta?.timeoutMs) === 35
  ),
  'expected ordered flush timeout error metadata'
);

const finalSnapshot = appender.snapshot();
assert.equal(finalSnapshot.flushActive, null, 'expected active flush marker to clear after timeout');

if (typeof releaseBlockedWrite === 'function') {
  releaseBlockedWrite();
}

console.log('ordered appender flush-timeout test passed');
