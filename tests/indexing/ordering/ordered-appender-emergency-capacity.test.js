#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logs = [];
const appender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 6,
    startIndex: 0,
    maxPendingBeforeBackpressure: 2,
    maxPendingEmergencyFactor: 3,
    stallMs: 25,
    log: (message) => logs.push(String(message || ''))
  }
);

void appender.enqueue(1, { id: 1 }).catch(() => {});
void appender.enqueue(2, { id: 2 }).catch(() => {});
void appender.enqueue(3, { id: 3 }).catch(() => {});

const gate = appender.waitForCapacity();
const initialState = await Promise.race([
  gate.then(() => 'resolved'),
  sleep(10).then(() => 'pending')
]);
assert.equal(initialState, 'pending', 'expected waitForCapacity to block at base pending limit');

const emergencyState = await Promise.race([
  gate.then(() => 'resolved'),
  sleep(120).then(() => 'pending')
]);
assert.equal(emergencyState, 'resolved', 'expected emergency capacity to release stalled backpressure waiters');
assert.ok(
  logs.some((message) => message.includes('emergency capacity enabled')),
  'expected emergency-capacity enable log'
);

appender.abort(new Error('test cleanup'));

const failOpenLogs = [];
const failOpenAppender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 64,
    startIndex: 0,
    maxPendingBeforeBackpressure: 2,
    maxPendingEmergencyFactor: 2,
    stallMs: 25,
    log: (message) => failOpenLogs.push(String(message || ''))
  }
);
const bufferedDone = [];
for (let index = 1; index <= 8; index += 1) {
  bufferedDone.push(failOpenAppender.enqueue(index, { id: index }));
}
const failOpenGate = failOpenAppender.waitForCapacity();
const failOpenInitialState = await Promise.race([
  failOpenGate.then(() => 'resolved'),
  sleep(10).then(() => 'pending')
]);
assert.equal(
  failOpenInitialState,
  'pending',
  'expected capacity gate to block while pending work exceeds the base limit'
);
const failOpenResolvedState = await Promise.race([
  failOpenGate.then(() => 'resolved'),
  sleep(140).then(() => 'pending')
]);
assert.equal(
  failOpenResolvedState,
  'resolved',
  'expected emergency mode to fail open even when pending exceeds emergency limit'
);
const emergencyStickyGate = failOpenAppender.waitForCapacity();
const emergencyStickyState = await Promise.race([
  emergencyStickyGate.then(() => 'resolved'),
  sleep(20).then(() => 'pending')
]);
assert.equal(
  emergencyStickyState,
  'resolved',
  'expected emergency mode to stay active until ordered progress advances'
);
await failOpenAppender.enqueue(0, { id: 0 });
await Promise.all(bufferedDone);
void failOpenAppender.enqueue(10, { id: 10 }).catch(() => {});
void failOpenAppender.enqueue(11, { id: 11 }).catch(() => {});
void failOpenAppender.enqueue(12, { id: 12 }).catch(() => {});
const postProgressGate = failOpenAppender.waitForCapacity();
const postProgressState = await Promise.race([
  postProgressGate.then(() => 'resolved'),
  sleep(10).then(() => 'pending')
]);
assert.equal(
  postProgressState,
  'pending',
  'expected emergency mode to reset after ordered progress resumes'
);
assert.ok(
  failOpenLogs.some((message) => message.includes('emergency capacity enabled')),
  'expected fail-open emergency activation log'
);
failOpenAppender.abort(new Error('test cleanup'));

console.log('ordered appender emergency capacity test passed');

