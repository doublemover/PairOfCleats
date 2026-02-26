#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'shape-a',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'shape-a-hash',
  async run() {
    return {
      byChunkUid: {
        'ck64:v1:test:src/sample.js:shape': {
          payload: {
            returnType: 'number',
            paramTypes: {
              x: { type: 'number', source: 'shape-a', confidence: 0.5 },
              y: 'string'
            }
          },
          provenance: {
            provider: 'shape-a',
            version: '1.0.0',
            collectedAt: '2026-02-25T00:00:00.000Z'
          }
        }
      }
    };
  }
});

registerToolingProvider({
  id: 'shape-b',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'shape-b-hash',
  async run() {
    return {
      byChunkUid: {
        'ck64:v1:test:src/sample.js:shape': {
          payload: {
            paramTypes: {
              x: [{ type: 'string', source: 'shape-b', confidence: 0.8 }]
            }
          },
          provenance: [{
            provider: 'shape-b',
            version: '1.0.0',
            collectedAt: '2026-02-25T00:00:01.000Z'
          }]
        }
      }
    };
  }
});

const chunkUid = 'ck64:v1:test:src/sample.js:shape';
const inputs = {
  documents: [],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_shape',
      file: 'src/sample.js',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 10 }
    },
    name: 'shapeTarget',
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
assert.equal(merged.payload.returnType, 'number');

const xTypes = Array.isArray(merged.payload?.paramTypes?.x)
  ? merged.payload.paramTypes.x.map((entry) => entry?.type).filter(Boolean)
  : [];
assert.ok(xTypes.includes('number'), 'expected coerced object param type');
assert.ok(xTypes.includes('string'), 'expected merged array param type');

assert.ok(Array.isArray(merged.provenance), 'expected normalized provenance list');
assert.ok(merged.provenance.length >= 2, 'expected provenance entries from both providers');
assert.equal(
  merged.provenance.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)),
  true,
  'expected provenance list to stay flat'
);

console.log('tooling provider param type shape coercion test passed');
