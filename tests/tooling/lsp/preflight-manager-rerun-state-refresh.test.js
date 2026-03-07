#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  awaitToolingProviderPreflight,
  readToolingProviderPreflightState
} from '../../../src/index/tooling/preflight-manager.js';

const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: () => {}
};

let invocationCount = 0;
const provider = {
  id: 'rerun-snapshot-provider',
  preflightId: 'rerun-snapshot-provider.health-check',
  getConfigHash() {
    return 'rerun-snapshot-provider-hash';
  },
  async preflight() {
    invocationCount += 1;
    if (invocationCount === 1) {
      return { state: 'ready', reasonCode: null, message: '' };
    }
    throw new Error('forced rerun failure');
  }
};

await awaitToolingProviderPreflight(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'a.txt', languageId: 'plaintext' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-a', file: 'a.txt', chunkId: 1 } }]
  }
});

const firstSnapshot = readToolingProviderPreflightState(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'a.txt', languageId: 'plaintext' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-a', file: 'a.txt', chunkId: 1 } }]
  }
});
assert.equal(firstSnapshot?.state, 'ready', 'expected first execution to set ready snapshot');

await assert.rejects(
  () => awaitToolingProviderPreflight(ctx, {
    provider,
    inputs: {
      documents: [{ virtualPath: 'a.txt', languageId: 'plaintext' }],
      targets: [{ chunkRef: { chunkUid: 'chunk-a', file: 'a.txt', chunkId: 1 } }]
    }
  }),
  /forced rerun failure/,
  'expected second execution to fail'
);

const secondSnapshot = readToolingProviderPreflightState(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'a.txt', languageId: 'plaintext' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-a', file: 'a.txt', chunkId: 1 } }]
  }
});
assert.equal(secondSnapshot?.state, 'failed', 'expected rerun failure to replace prior ready snapshot');
assert.equal(
  secondSnapshot?.diagnostic?.reasonCode,
  'preflight_failed',
  'expected rerun failure diagnostic reason code'
);

console.log('preflight manager rerun snapshot refresh test passed');
