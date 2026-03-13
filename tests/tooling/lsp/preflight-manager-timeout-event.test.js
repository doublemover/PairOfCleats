#!/usr/bin/env node
import assert from 'node:assert/strict';
import { awaitToolingProviderPreflight } from '../../../src/index/tooling/preflight-manager.js';

const logs = [];
const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: (line) => logs.push(String(line || ''))
};

const provider = {
  id: 'timeout-fixture',
  preflightId: 'timeout-fixture.preflight',
  getConfigHash() {
    return 'timeout-hash';
  },
  async preflight() {
    return {
      state: 'degraded',
      timeout: true,
      reasonCode: 'preflight_timeout'
    };
  }
};

const result = await awaitToolingProviderPreflight(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-1', chunkId: 'chunk-1', file: 'src/file.fixture' } }]
  }
});

assert.equal(result?.state, 'degraded', 'expected normalized state to remain degraded');
assert.equal(result?.timedOut, true, 'expected timedOut marker');
assert.ok(
  logs.some((line) => line.includes('preflight:timeout provider=timeout-fixture')),
  'expected canonical timeout log event'
);
assert.ok(
  logs.some((line) => line.includes('state=degraded')),
  'expected timeout log to preserve state detail'
);

console.log('preflight manager timeout event test passed');
