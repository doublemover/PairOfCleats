#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'prototype-keys',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'prototype-keys-hash',
  async run() {
    const paramTypes = Object.create(null);
    paramTypes.toString = [{ type: 'string', source: 'tooling', confidence: 0.8 }];
    paramTypes.constructor = [{ type: 'number', source: 'tooling', confidence: 0.9 }];
    paramTypes.__proto__ = [{ type: 'boolean', source: 'tooling', confidence: 0.7 }];
    return {
      byChunkUid: {
        'ck64:v1:test:src/sample.ts:proto': {
          payload: {
            paramTypes
          },
          provenance: {
            provider: 'prototype-keys',
            version: '1.0.0',
            collectedAt: '2026-02-26T00:00:00.000Z'
          }
        }
      }
    };
  }
});

const chunkUid = 'ck64:v1:test:src/sample.ts:proto';
const inputs = {
  documents: [],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_proto',
      file: 'src/sample.ts',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 16 }
    },
    name: 'protoTarget',
    virtualPath: 'src/sample.ts',
    virtualRange: { start: 0, end: 16 }
  }]
};

const result = await runToolingProviders({
  strict: true,
  toolingConfig: {},
  cache: { enabled: false }
}, inputs);

const merged = result.byChunkUid.get(chunkUid);
assert.ok(merged, 'expected merged tooling entry');
const paramTypes = merged.payload?.paramTypes;
assert.ok(paramTypes && typeof paramTypes === 'object', 'expected paramTypes payload');
assert.equal(Object.getPrototypeOf(paramTypes), null, 'expected null-prototype paramTypes map');

for (const key of ['toString', 'constructor', '__proto__']) {
  assert.equal(Object.hasOwn(paramTypes, key), true, `expected merged key ${key}`);
  assert.ok(Array.isArray(paramTypes[key]), `expected merged paramTypes.${key} array`);
  assert.ok(paramTypes[key].length > 0, `expected merged paramTypes.${key} entries`);
}

console.log('tooling provider param type prototype keys test passed');
