#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'alpha',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'hash-alpha',
  async run() {
    return {
      byChunkUid: {
        'ck64:v1:test:src/sample.js:deadbeef': {
          payload: {
            returnType: 'number'
          }
        }
      }
    };
  }
});

registerToolingProvider({
  id: 'beta',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'hash-beta',
  async run() {
    return {
      byChunkUid: {
        'ck64:v1:test:src/sample.js:deadbeef': {
          payload: {
            returnType: 'string',
            paramTypes: {
              x: [{ type: 'number', confidence: 0.8, source: 'tooling' }]
            }
          }
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
}, inputs);

const merged = result.byChunkUid.get(chunkUid);
assert.ok(merged, 'expected merged tooling entry');
assert.equal(merged.payload.returnType, 'number', 'expected deterministic precedence for returnType');
assert.ok(Array.isArray(merged.payload.paramTypes?.x), 'expected merged paramTypes from second provider');

console.log('tooling provider deterministic merge test passed');
