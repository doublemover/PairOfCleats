#!/usr/bin/env node
import assert from 'node:assert/strict';
import { retryWithBackoff } from '../../../src/shared/retry.js';

const originalRandom = Math.random;
const originalSetTimeout = global.setTimeout;

const runWithRandom = async ({ randomValue, expectedDelay }) => {
  let capturedDelay = null;
  Math.random = () => randomValue;
  global.setTimeout = (fn, ms, ...args) => {
    capturedDelay = ms;
    return originalSetTimeout(fn, 0, ...args);
  };

  const result = await retryWithBackoff({
    task: async ({ attempt }) => (attempt > 0 ? 'ok' : null),
    shouldStop: () => false,
    baseMs: 10,
    maxMs: 100,
    maxWaitMs: 1000,
    logIntervalMs: 0
  });

  assert.equal(result, 'ok');
  assert.equal(capturedDelay, expectedDelay);
};

try {
  let called = 0;
  const stopped = await retryWithBackoff({
    task: async () => {
      called += 1;
      return null;
    },
    shouldStop: () => true,
    baseMs: 10,
    maxMs: 20,
    maxWaitMs: 50
  });
  assert.equal(stopped, null);
  assert.equal(called, 0, 'expected shouldStop to prevent task execution');

  await runWithRandom({ randomValue: 0, expectedDelay: 13 });
  await runWithRandom({ randomValue: 1, expectedDelay: 17 });
} finally {
  Math.random = originalRandom;
  global.setTimeout = originalSetTimeout;
}

console.log('retry with backoff test passed');
