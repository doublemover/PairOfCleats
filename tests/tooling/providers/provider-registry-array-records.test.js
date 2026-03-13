#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'throws-provider',
  version: '1.0.0',
  priority: 1,
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'throws-provider-hash',
  async run() {
    throw new Error('simulated provider failure');
  }
});

registerToolingProvider({
  id: 'array-records',
  version: '1.0.0',
  priority: 2,
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'array-records-hash',
  async run() {
    return {
      byChunkUid: [[
        'ck64:v1:test:src/sample.js:array',
        {
          payload: {
            returnType: 'number'
          }
        }
      ]]
    };
  }
});

const chunkUid = 'ck64:v1:test:src/sample.js:array';
const inputs = {
  documents: [],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_array',
      file: 'src/sample.js',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 10 }
    },
    name: 'arrayTarget',
    virtualPath: 'src/sample.js',
    virtualRange: { start: 0, end: 10 }
  }]
};

const result = await runToolingProviders({
  strict: true,
  toolingConfig: {},
  cache: { enabled: false }
}, inputs);

const merged = result.byChunkUid.get(chunkUid);
assert.ok(merged, 'expected array tuple byChunkUid payload to resolve to actual chunkUid');
assert.equal(merged.payload.returnType, 'number');
assert.equal(
  Array.isArray(result.degradedProviders)
  && result.degradedProviders.some((entry) => entry?.providerId === 'throws-provider'),
  true,
  'expected thrown provider to be reported in degraded providers'
);
assert.equal(
  Array.isArray(result.observations)
  && result.observations.some((entry) => entry?.code === 'tooling_provider_execution_failed'),
  true,
  'expected provider execution failure observation'
);

console.log('tooling provider array-record payload test passed');
