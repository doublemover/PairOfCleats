#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const appender = buildOrderedAppender(
  async () => {},
  {},
  {
    expectedCount: 2,
    startIndex: 0
  }
);

appender.abort(new Error('forced abort'));

const enqueueState = await Promise.race([
  appender.enqueue(0, { id: 0 }, null)
    .then(() => ({ state: 'resolved', error: null }))
    .catch((error) => ({ state: 'rejected', error })),
  new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout', error: null }), 100))
]);

assert.equal(enqueueState.state, 'rejected', 'expected post-abort enqueue to reject instead of hanging');
assert.match(String(enqueueState.error?.message || ''), /forced abort/i, 'expected abort error to propagate');
assert.equal(appender.snapshot().pendingCount, 0, 'expected no pending envelopes after post-abort enqueue');

console.log('ordered appender post-abort settle test passed');
