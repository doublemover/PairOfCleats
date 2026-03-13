#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { awaitToolingProviderPreflight } from '../../../src/index/tooling/preflight-manager.js';
import {
  TOOLING_PROVIDERS,
  registerToolingProvider
} from '../../../src/index/tooling/provider-registry.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

TOOLING_PROVIDERS.clear();

const registerFixtureProvider = (id, priority) => {
  const provider = {
    id,
    version: '1.0.0',
    priority,
    preflightId: `${id}.workspace-model`,
    preflightClass: 'workspace',
    capabilities: {
      supportsVirtualDocuments: true,
      supportsSegmentRouting: true
    },
    getConfigHash() {
      return `${id}-hash`;
    },
    async preflight() {
      await wait(60);
      return { state: 'ready' };
    },
    async run(ctx, inputs) {
      await awaitToolingProviderPreflight(ctx, {
        provider,
        inputs,
        waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
          ? inputs.toolingPreflightWaveToken
          : null
      });
      return { byChunkUid: {} };
    }
  };
  registerToolingProvider(provider);
};

registerFixtureProvider('preflight-alpha', 5);
registerFixtureProvider('preflight-beta', 10);

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
    docHash: 'doc-hash-1'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'chunk-1',
      chunkId: 'chunk-1',
      file: 'src/sample.fixture',
      range: { start: 0, end: 1 }
    },
    virtualPath: 'src/sample.fixture',
    virtualRange: { start: 0, end: 1 }
  }]
});

assert.equal(Number(result.metrics?.preflights?.total || 0), 2, 'expected both provider preflights to be tracked');

const alphaStartIndex = logs.findIndex((line) => line.includes('preflight:start provider=preflight-alpha'));
const betaStartIndex = logs.findIndex((line) => line.includes('preflight:start provider=preflight-beta'));
const alphaDoneIndex = logs.findIndex((line) => line.includes('provider 1/2 done id=preflight-alpha'));

assert.notEqual(alphaStartIndex, -1, 'expected alpha preflight start log');
assert.notEqual(betaStartIndex, -1, 'expected beta preflight start log');
assert.notEqual(alphaDoneIndex, -1, 'expected alpha provider completion log');
assert.equal(
  betaStartIndex < alphaDoneIndex,
  true,
  'expected later-provider preflight to begin before the first provider finished'
);

console.log('tooling provider preflight overlap test passed');
