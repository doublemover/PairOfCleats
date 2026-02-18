#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processed = [];
const capacityAppender = buildOrderedAppender(
  async (result) => {
    processed.push(result.id);
  },
  {},
  {
    expectedCount: 4,
    startIndex: 0,
    maxPendingBeforeBackpressure: 2,
    stallMs: 0
  }
);
const done1 = capacityAppender.enqueue(1, { id: 1 });
const done2 = capacityAppender.enqueue(2, { id: 2 });
const done3 = capacityAppender.enqueue(3, { id: 3 });
const capacityGate = capacityAppender.waitForCapacity();
const capacityState = await Promise.race([
  capacityGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(capacityState, 'pending', 'expected capacity gate to wait when pending buffer exceeds limit');
await capacityAppender.enqueue(0, { id: 0 });
await capacityGate;
await Promise.all([done1, done2, done3]);
assert.deepEqual(processed, [0, 1, 2, 3], 'expected deterministic flush order with buffered progress');

const waitingLogs = [];
const waitingAppender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 6,
    startIndex: 0,
    stallMs: 25,
    log: (message) => waitingLogs.push(String(message || ''))
  }
);
void waitingAppender.enqueue(2, { id: 2 }).catch(() => {});
void waitingAppender.enqueue(3, { id: 3 }).catch(() => {});
await sleep(60);
assert.ok(
  waitingLogs.some((message) => message.includes('[ordered] waiting on index 0')),
  'expected waiting log while unseen work remains'
);
assert.ok(
  waitingLogs.some((message) => message.includes('unseen=4')),
  'expected waiting log to include unseen count'
);
assert.ok(
  !waitingLogs.some((message) => message.includes('[ordered] stalled at index')),
  'did not expect stalled log while unseen work remains'
);
waitingAppender.abort(new Error('test cleanup'));

const stalledLogs = [];
const stalledAppender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 1,
    startIndex: 0,
    stallMs: 25,
    log: (message) => stalledLogs.push(String(message || ''))
  }
);
void stalledAppender.enqueue(2, { id: 2 }).catch(() => {});
await sleep(60);
assert.ok(
  stalledLogs.some((message) => message.includes('[ordered] stalled at index 0')),
  'expected stalled log when all expected indices are seen and ordering cannot advance'
);
stalledAppender.abort(new Error('test cleanup'));

console.log('ordered appender progress/stall test passed');
