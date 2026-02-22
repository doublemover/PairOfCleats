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
    expectedCount: 6,
    startIndex: 0,
    maxPendingBeforeBackpressure: 2,
    stallMs: 0
  }
);

void appender.enqueue(1, { id: 1 }).catch(() => {});
void appender.enqueue(2, { id: 2 }).catch(() => {});
void appender.enqueue(3, { id: 3 }).catch(() => {});

const strictGate = appender.waitForCapacity();
const strictState = await Promise.race([
  strictGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(strictState, 'pending', 'expected strict waitForCapacity to block when pending exceeds limit');

const nearHeadGate = appender.waitForCapacity({ orderIndex: 1, bypassWindow: 1 });
const nearHeadState = await Promise.race([
  nearHeadGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(
  nearHeadState,
  'resolved',
  'expected near-head order index to bypass capacity wait and avoid head-of-line dispatch stalls'
);

const farGate = appender.waitForCapacity({ orderIndex: 20, bypassWindow: 1 });
const farState = await Promise.race([
  farGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(farState, 'pending', 'expected far-future index to remain backpressured');

await appender.enqueue(0, { id: 0 });
await Promise.race([
  farGate,
  sleep(200).then(() => {
    throw new Error('expected farGate to resolve once ordering catches up');
  })
]);

console.log('ordered appender capacity bypass test passed');
