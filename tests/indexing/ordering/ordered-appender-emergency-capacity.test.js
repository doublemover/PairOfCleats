#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const logs = [];
const appender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 6,
    startIndex: 0,
    maxPendingBeforeBackpressure: 2,
    log: (message) => logs.push(String(message || ''))
  }
);

void appender.enqueue(1, { id: 1 }).catch(() => {});
void appender.enqueue(2, { id: 2 }).catch(() => {});
void appender.enqueue(3, { id: 3 }).catch(() => {});

await assert.rejects(
  appender.waitForCapacity({
    timeoutMs: 30
  }),
  (error) => error?.code === 'ORDERED_CAPACITY_WAIT_TIMEOUT',
  'expected head-of-line stall to remain backpressured without emergency fail-open'
);
assert.ok(
  !logs.some((message) => message.includes('emergency capacity enabled')),
  'expected no emergency-capacity fail-open logging in hard-cutover mode'
);

appender.abort(new Error('test cleanup'));

console.log('ordered appender emergency capacity test passed');
