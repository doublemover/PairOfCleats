#!/usr/bin/env node
import assert from 'node:assert/strict';
import { awaitToolingProviderPreflight } from '../../../src/index/tooling/preflight-manager.js';

const withTimeout = async (promise, timeoutMs = 1200) => {
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error(`test timed out after ${timeoutMs}ms`);
          err.code = 'TEST_TIMEOUT';
          reject(err);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

let attempts = 0;
const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: () => {}
};

const provider = {
  id: 'enforced-timeout-fixture',
  preflightId: 'enforced-timeout-fixture.preflight',
  preflightTimeoutMs: 40,
  getConfigHash() {
    return 'enforced-timeout-fixture';
  },
  async preflight() {
    attempts += 1;
    return await new Promise(() => {});
  }
};

const inputs = {
  documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }],
  targets: [{ chunkRef: { chunkUid: 'chunk-1', chunkId: 'chunk-1', file: 'src/file.fixture' } }]
};

await assert.rejects(
  () => withTimeout(awaitToolingProviderPreflight(ctx, { provider, inputs }), 1500),
  (error) => error?.code === 'TOOLING_PREFLIGHT_TIMEOUT',
  'expected preflight manager to enforce provider timeout on hung preflight'
);

await assert.rejects(
  () => withTimeout(awaitToolingProviderPreflight(ctx, { provider, inputs }), 1500),
  (error) => error?.code === 'TOOLING_PREFLIGHT_TIMEOUT',
  'expected timed-out in-flight entry to be evicted so subsequent calls do not hang'
);

assert.equal(attempts, 2, 'expected second call to run a new attempt instead of reusing a stuck in-flight promise');

console.log('preflight manager enforced-timeout test passed');
