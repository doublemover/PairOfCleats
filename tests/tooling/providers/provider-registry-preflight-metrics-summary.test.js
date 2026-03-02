#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

TOOLING_PROVIDERS.clear();

let preflightCalls = 0;
registerToolingProvider({
  id: 'preflight-fixture',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  preflightId: 'preflight-fixture.bootstrap',
  getConfigHash: () => 'hash-preflight-fixture',
  async preflight() {
    preflightCalls += 1;
    await wait(25);
    return { state: 'ready' };
  },
  async run() {
    return {
      byChunkUid: {}
    };
  }
});

const logs = [];
const result = await runToolingProviders({
  strict: true,
  toolingConfig: {},
  cache: { enabled: false },
  logger: (line) => logs.push(String(line || ''))
}, {
  documents: [{
    virtualPath: 'src/sample.fixture',
    languageId: 'fixture',
    docHash: 'hash-1'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'chunk-1',
      chunkId: 'chunk-1',
      file: 'src/sample.fixture',
      range: { start: 0, end: 1 }
    },
    name: 'sample',
    virtualPath: 'src/sample.fixture',
    virtualRange: { start: 0, end: 1 }
  }]
});

assert.equal(preflightCalls, 1, 'expected kickoff + provider execution to reuse one preflight run');
assert.ok(result?.metrics?.preflights, 'expected preflight metrics envelope');
assert.equal(result.metrics.preflights.total, 1, 'expected one tracked preflight');
assert.equal(result.metrics.preflights.byState.ready, 1, 'expected ready preflight count');
assert.equal(result.metrics.preflights.byClass.dependency, 1, 'expected dependency class preflight count');
assert.equal(result.metrics.preflights.teardown?.timedOut, false, 'expected teardown to complete');
assert.equal(
  Number.isFinite(result.metrics.preflights.scheduler?.maxConcurrency),
  true,
  'expected scheduler metrics on preflight envelope'
);
assert.ok(result?.diagnostics?.['preflight-fixture']?.preflight, 'expected provider preflight diagnostics envelope');
assert.equal(
  result.diagnostics['preflight-fixture'].preflight.state,
  'ready',
  'expected preflight diagnostics state to be ready'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] preflight summary')),
  'expected preflight summary log line'
);

console.log('tooling provider preflight metrics summary test passed');
