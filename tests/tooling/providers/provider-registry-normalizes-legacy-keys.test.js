#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'legacy-stub',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'hash',
  async run() {
    return {
      byLegacyKey: {
        'src/sample.js::greet': {
          payload: { returnType: 'string' }
        }
      }
    };
  }
});

const chunkUid = 'ck64:v1:test:src/sample.js:deadbeef';
const inputs = {
  documents: [],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_deadbeef',
      file: 'src/sample.js',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 10 }
    },
    name: 'greet',
    virtualPath: 'src/sample.js',
    virtualRange: { start: 0, end: 10 }
  }]
};

const result = await runToolingProviders({
  strict: true,
  toolingConfig: {},
  cache: { enabled: false }
}, inputs, ['legacy-stub']);

assert.ok(result.byChunkUid instanceof Map, 'expected byChunkUid to be a Map');
assert.ok(result.byChunkUid.has(chunkUid), 'expected legacy key to normalize to chunkUid');

console.log('tooling provider legacy key normalization test passed');
