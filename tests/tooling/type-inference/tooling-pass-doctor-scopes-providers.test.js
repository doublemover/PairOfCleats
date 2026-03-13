#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'doctor-scope-fixture',
  version: '1.0.0',
  kinds: ['types'],
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'doctor-scope-fixture-v1',
  async run() {
    return {
      byChunkUid: {
        'chunk-1': {
          returnType: 'number'
        }
      }
    };
  }
});

const chunks = [{
  chunkUid: 'chunk-1',
  chunkId: 'chunk-1',
  file: 'src/sample.js',
  start: 0,
  end: 34,
  name: 'sum',
  kind: 'function',
  docmeta: {},
  metaV2: {
    symbol: {
      qualifiedName: 'sum'
    }
  }
}];

const entryByUid = new Map([[
  'chunk-1',
  {
    name: 'sum',
    file: 'src/sample.js',
    kind: 'function',
    chunkUid: 'chunk-1',
    qualifiedName: 'sum',
    paramTypes: {}
  }
]]);

const testRoot = path.join(
  process.cwd(),
  '.testLogs',
  `tooling-pass-doctor-scopes-providers-${process.pid}-${Date.now()}`
);
await fs.mkdir(path.join(testRoot, 'src'), { recursive: true });

const logs = [];
await runToolingPass({
  rootDir: testRoot,
  buildRoot: testRoot,
  chunks,
  entryByUid,
  log: (line) => logs.push(String(line || '')),
  toolingConfig: {
    enabledTools: ['doctor-scope-fixture'],
    doctorCache: false
  },
  toolingTimeoutMs: 2000,
  toolingRetries: 0,
  toolingBreaker: 1,
  toolingLogDir: null,
  fileTextByFile: new Map([
    ['src/sample.js', 'function sum(a, b) { return a + b; }\n']
  ]),
  abortSignal: null
});

assert.ok(
  logs.some((line) => line.includes('[tooling] providers:selected count=1.')),
  'expected selected provider count log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] providers:start docs=1 targets=1.')),
  'expected tooling runtime to start directly after provider selection'
);
assert.equal(
  logs.some((line) => line.includes('[tooling] doctor:')),
  false,
  'expected indexing runtime to skip standalone tooling doctor'
);

console.log('tooling pass skips standalone doctor runtime test passed');
