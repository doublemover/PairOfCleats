#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const withTimeout = async (promise, timeoutMs = 500) => {
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error(`timed out after ${timeoutMs}ms`);
          err.code = 'TEST_TIMEOUT';
          reject(err);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const appender = buildOrderedAppender(async () => {}, {
  chunks: [],
  fileMeta: [],
  symbols: []
}, {
  expectedIndices: [0]
});

await withTimeout(appender.enqueue(0, { id: 0 }, null), 800);

// Duplicate terminalization after commit should resolve immediately and never
// create a stranded completion waiter.
await withTimeout(appender.skip(0, 123), 800);

const snapshot = appender.snapshot();
assert.equal(snapshot.committedCount, 1, 'expected committed count to remain stable after duplicate terminalization');
assert.equal(snapshot.pendingCount, 0, 'expected no pending completion promises');

console.log('stage1 duplicate terminal-after-commit test passed');
