#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  kickoffToolingProviderPreflights,
  teardownToolingProviderPreflights
} from '../../../src/index/tooling/preflight-manager.js';

const logs = [];
const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: (line) => logs.push(String(line || ''))
};

const provider = {
  id: 'teardown-abort-fixture',
  preflightId: 'teardown-abort-fixture.preflight',
  getConfigHash() {
    return 'teardown-abort-hash';
  },
  async preflight(_ctx, inputs = {}) {
    const signal = inputs?.abortSignal;
    return await new Promise((resolve) => {
      if (!signal || typeof signal.addEventListener !== 'function') {
        setTimeout(() => resolve({ state: 'ready' }), 5000);
        return;
      }
      if (signal.aborted) {
        resolve({ state: 'blocked', reasonCode: 'preflight_timeout', timedOut: true });
        return;
      }
      signal.addEventListener('abort', () => {
        resolve({ state: 'blocked', reasonCode: 'preflight_timeout', timedOut: true });
      }, { once: true });
    });
  }
};

kickoffToolingProviderPreflights(ctx, [{
  provider,
  documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }],
  targets: [{ chunkRef: { chunkUid: 'chunk-1', chunkId: 'chunk-1', file: 'src/file.fixture' } }]
}]);

const timedOut = await teardownToolingProviderPreflights(ctx, { timeoutMs: 10 });
assert.equal(timedOut.timedOut, true, 'expected teardown timeout result');
assert.equal(timedOut.total, 1, 'expected one tracked preflight');
assert.equal(timedOut.aborted >= 1, true, 'expected teardown to abort at least one preflight');
assert.ok(
  logs.some((line) => line.includes('preflight:teardown_abort')),
  'expected teardown abort log'
);

const settled = await teardownToolingProviderPreflights(ctx, { timeoutMs: 10 });
assert.equal(settled.total, 0, 'expected no in-flight preflights after teardown abort');

console.log('preflight manager teardown abort test passed');
