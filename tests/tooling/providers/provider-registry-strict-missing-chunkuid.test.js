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
    return { byChunkUid: {} };
  }
});

let threw = false;
try {
  await runToolingProviders({
    strict: true,
    toolingConfig: {},
    cache: { enabled: false }
  }, {
    documents: [],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: null,
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
  });
} catch (err) {
  threw = true;
}

assert.ok(threw, 'expected strict mode to reject missing chunkUid');

console.log('tooling provider strict chunkUid test passed');
