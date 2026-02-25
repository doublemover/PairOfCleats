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
    expectedCount: 4,
    startIndex: 0,
    maxPendingBeforeBackpressure: 2
  }
);

const done1 = appender.enqueue(1, { id: 1 }).catch(() => {});
const done2 = appender.enqueue(2, { id: 2 }).catch(() => {});
const done3 = appender.enqueue(3, { id: 3 }).catch(() => {});

const capacityGate = appender.waitForCapacity();
const capacityState = await Promise.race([
  capacityGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(capacityState, 'pending', 'expected capacity gate to block while head seq is missing');

const snapshot = appender.snapshot();
assert.equal(snapshot.nextCommitSeq, 0, 'expected commit cursor to remain pinned at leading gap');
assert.equal(snapshot.pendingCount, 3, 'expected buffered envelope count for out-of-order terminals');
assert.ok(snapshot.commitLag >= 3, 'expected commit lag to reflect buffered head-of-line gap');

appender.abort(new Error('test cleanup'));
await assert.rejects(
  capacityGate,
  (error) => (error?.message || '').includes('test cleanup'),
  'expected pending capacity wait to reject on appender abort'
);
await Promise.all([done1, done2, done3]);

console.log('ordered appender progress/stall snapshot test passed');
