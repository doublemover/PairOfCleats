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

console.log('ordered appender emergency capacity test passed');

