#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const appender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 3,
    startIndex: 0,
    maxPendingBeforeBackpressure: 100,
    maxPendingBytes: 200,
    resumeHysteresisRatio: 0.7
  }
);

void appender.enqueue(1, { id: 1, postingsPayload: { bytes: 150 } }, null);
void appender.enqueue(2, { id: 2, postingsPayload: { bytes: 150 } }, null);

const capacityGate = appender.waitForCapacity({
  orderIndex: 99,
  bypassWindow: 0,
  timeoutMs: 30
});
const preHeadState = await Promise.race([
  capacityGate.then(() => 'settled'),
  sleep(20).then(() => 'pending')
]);
assert.equal(
  preHeadState,
  'pending',
  'expected byte-budget backpressure to hold far-future dispatch while buffered bytes exceed threshold'
);
await assert.rejects(
  capacityGate,
  (error) => error?.code === 'ORDERED_CAPACITY_WAIT_TIMEOUT',
  'expected byte-budget backpressure timeout under sustained over-budget buffered bytes'
);

await appender.waitForCapacity({
  orderIndex: 1,
  bypassWindow: 1,
  timeoutMs: 30
});

console.log('stage1 byte-budget hysteresis test passed');
