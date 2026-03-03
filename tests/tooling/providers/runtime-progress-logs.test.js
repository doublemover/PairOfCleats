#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'progress-fixture',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'hash-progress-fixture',
  async run() {
    return {
      byChunkUid: {}
    };
  }
});

const logs = [];
await runToolingProviders({
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

assert.ok(
  logs.some((line) => line.includes('[tooling] provider runtime start providers=1')),
  'expected provider runtime start progress log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] provider 1/1 start id=progress-fixture')),
  'expected provider start progress log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] provider 1/1 done id=progress-fixture')),
  'expected provider done progress log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] provider runtime done providers=1')),
  'expected provider runtime done progress log'
);

console.log('tooling provider runtime progress logs test passed');
