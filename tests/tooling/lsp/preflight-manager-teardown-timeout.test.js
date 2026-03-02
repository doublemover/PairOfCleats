#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  kickoffToolingProviderPreflights,
  teardownToolingProviderPreflights
} from '../../../src/index/tooling/preflight-manager.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logs = [];
const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: (line) => logs.push(String(line || ''))
};

const provider = {
  id: 'teardown-fixture',
  preflightId: 'teardown-fixture.preflight',
  getConfigHash() {
    return 'teardown-hash';
  },
  async preflight() {
    await wait(120);
    return { state: 'ready' };
  }
};

kickoffToolingProviderPreflights(ctx, [{
  provider,
  documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }],
  targets: [{ chunkRef: { chunkUid: 'chunk-1', chunkId: 'chunk-1', file: 'src/file.fixture' } }]
}]);

const timedOut = await teardownToolingProviderPreflights(ctx, { timeoutMs: 10 });
assert.equal(timedOut.timedOut, true, 'expected first teardown call to time out');
assert.equal(timedOut.total, 1, 'expected one in-flight preflight task');
assert.ok(
  logs.some((line) => line.includes('preflight:teardown_timeout')),
  'expected teardown timeout log'
);

await wait(170);
const settled = await teardownToolingProviderPreflights(ctx, { timeoutMs: 10 });
assert.equal(settled.timedOut, false, 'expected settled teardown after preflight completion');
assert.equal(settled.total, 0, 'expected no active preflights after completion');

console.log('preflight manager teardown timeout test passed');
