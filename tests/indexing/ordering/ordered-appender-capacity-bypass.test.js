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

appender.abort(new Error('test cleanup'));
await assert.rejects(
  farGate,
  (error) => (error?.message || '').includes('test cleanup'),
  'expected far-future gate to reject when appender aborts under head-of-line gap'
);
await assert.rejects(
  strictGate,
  (error) => (error?.message || '').includes('test cleanup'),
  'expected strict gate to reject when appender aborts under head-of-line gap'
);

const deferredBypassAppender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 32,
    startIndex: 0,
    maxPendingBeforeBackpressure: 1,
    stallMs: 0
  }
);
void deferredBypassAppender.enqueue(10, { id: 10 }).catch(() => {});
void deferredBypassAppender.enqueue(11, { id: 11 }).catch(() => {});
void deferredBypassAppender.enqueue(12, { id: 12 }).catch(() => {});
const deferredGate = deferredBypassAppender.waitForCapacity({
  orderIndex: 5,
  bypassWindow: 0,
  timeoutMs: 500
});
const deferredInitialState = await Promise.race([
  deferredGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(
  deferredInitialState,
  'pending',
  'expected deferred gate to block while order index is still far from next index'
);
deferredBypassAppender.abort(new Error('test cleanup'));
await assert.rejects(
  deferredGate,
  (error) => (error?.message || '').includes('test cleanup'),
  'expected deferred gate to reject when appender aborts with unresolved head seq'
);

const timeoutAppender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 32,
    startIndex: 0,
    maxPendingBeforeBackpressure: 1,
    stallMs: 0
  }
);
void timeoutAppender.enqueue(10, { id: 10 }).catch(() => {});
void timeoutAppender.enqueue(11, { id: 11 }).catch(() => {});
await assert.rejects(
  timeoutAppender.waitForCapacity({
    orderIndex: 20,
    bypassWindow: 0,
    timeoutMs: 30
  }),
  (error) => error?.code === 'ORDERED_CAPACITY_WAIT_TIMEOUT',
  'expected capacity wait timeout when backpressure cannot clear'
);
timeoutAppender.abort(new Error('test cleanup'));

console.log('ordered appender capacity bypass test passed');
