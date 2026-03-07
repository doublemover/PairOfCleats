#!/usr/bin/env node
import assert from 'node:assert/strict';

import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();
registerToolingProvider({
  id: 'stub',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'hash',
  async run() {
    return {
      byChunkUid: {
        'unknown-chunk': {
          payload: { returnType: 'string' }
        }
      }
    };
  }
});

await assert.rejects(
  () => runToolingProviders({
    strict: true,
    toolingConfig: {},
    cache: { enabled: false }
  }, {
    documents: [{
      virtualPath: 'src/sample.js',
      docHash: 'doc-hash-1',
      text: 'function a() {}'
    }],
    targets: [{
      chunkRef: {
        chunkUid: 'chunk-a',
        chunkId: 'chunk-a-id',
        file: 'src/sample.js',
        start: 0,
        end: 10
      },
      virtualPath: 'src/sample.js',
      virtualRange: { start: 0, end: 10 }
    }],
    kinds: ['types']
  }),
  /chunkUid unresolved/,
  'expected strict mode to reject provider output for unknown chunkUid'
);

TOOLING_PROVIDERS.clear();
console.log('tooling provider strict unresolved output chunkUid test passed');
