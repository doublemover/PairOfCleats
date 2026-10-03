#!/usr/bin/env node
import assert from 'node:assert/strict';

import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'prov-a',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'prov-a-hash',
  async run() {
    return {
      byChunkUid: {
        'ck64:v1:test:src/sample.js:provenance': {
          payload: {
            returnType: 'number'
          },
          provenance: {
            provider: 'prov-a',
            version: '1.0.0',
            collectedAt: '2026-03-19T00:00:00.000Z',
            source: 'lsp',
            stages: {
              documentSymbol: true,
              hover: { requested: true, succeeded: true }
            },
            quality: {
              score: 9,
              incomplete: false
            },
            confidence: {
              score: 0.93,
              tier: 'high'
            }
          }
        }
      }
    };
  }
});

const chunkUid = 'ck64:v1:test:src/sample.js:provenance';
const result = await runToolingProviders({
  strict: true,
  toolingConfig: {},
  cache: { enabled: false }
}, {
  documents: [],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_provenance',
      file: 'src/sample.js',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 10 }
    },
    name: 'add',
    virtualPath: 'src/sample.js',
    virtualRange: { start: 0, end: 10 }
  }]
});

const merged = result.byChunkUid.get(chunkUid);
assert.ok(merged, 'expected merged tooling entry');
assert.ok(Array.isArray(merged.provenance), 'expected normalized provenance list');
assert.equal(merged.provenance[0]?.source, 'lsp', 'expected provenance source to be retained');
assert.equal(merged.provenance[0]?.stages?.hover?.succeeded, true, 'expected nested stage provenance to be retained');
assert.equal(merged.provenance[0]?.quality?.score, 9, 'expected quality metadata to be retained');
assert.equal(merged.provenance[0]?.confidence?.tier, 'high', 'expected confidence metadata to be retained');

console.log('tooling provider provenance retention test passed');
