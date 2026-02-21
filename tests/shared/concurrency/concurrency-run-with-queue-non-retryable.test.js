#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runWithQueue } from '../../../src/shared/concurrency.js';

ensureTestingEnv(process.env);

const queue = new PQueue({ concurrency: 1 });
let attempts = 0;
const marker = new Error('non-retryable');
marker.retryable = false;

const err = await runWithQueue(
  queue,
  [0],
  async () => {
    attempts += 1;
    throw marker;
  },
  {
    retries: 5,
    retryDelayMs: 1
  }
).then(() => null, (error) => error);

assert.equal(attempts, 1, 'expected non-retryable failures to bypass retry loops');
assert.equal(err, marker, 'expected original error to surface');

console.log('concurrency non-retryable test passed');

