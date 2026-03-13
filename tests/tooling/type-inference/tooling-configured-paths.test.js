#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'configured-paths-fixture',
  version: '1.0.0',
  kinds: ['types'],
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'configured-paths-fixture-v1',
  async run() {
    return {
      byChunkUid: {
        'chunk-1': {
          returnType: 'number'
        }
      },
      diagnostics: {
        'configured-paths-fixture': {
          diagnosticsByChunkUid: {
            'chunk-1': [{ severity: 'info', message: 'fixture diag' }]
          }
        }
      }
    };
  }
});

const testRoot = resolveTestCachePath(
  process.cwd(),
  `tooling-configured-paths-${process.pid}-${Date.now()}`
);
const sourceDir = path.join(testRoot, 'src');
const absCacheDir = path.join(testRoot, 'cache-root');
const absLogDir = path.join(testRoot, 'log-root');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(sourceDir, { recursive: true });
await fs.mkdir(absCacheDir, { recursive: true });
await fs.mkdir(absLogDir, { recursive: true });

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

const logs = [];
const result = await runToolingPass({
  rootDir: testRoot,
  buildRoot: testRoot,
  chunks,
  entryByUid,
  log: (line) => logs.push(String(line || '')),
  toolingConfig: {
    enabledTools: ['configured-paths-fixture'],
    cache: {
      enabled: true,
      dir: absCacheDir
    }
  },
  toolingTimeoutMs: 2000,
  toolingRetries: 0,
  toolingBreaker: 1,
  toolingLogDir: absLogDir,
  fileTextByFile: new Map([
    ['src/sample.js', 'function sum(a, b) { return a + b; }\n']
  ]),
  abortSignal: null
});

assert.equal(
  Number(result.toolingProvidersExecuted) >= 1,
  true,
  'expected tooling pass to execute the configured provider with absolute cache/log paths'
);
assert.equal(
  logs.some((line) => line.includes('[tooling] providers:done')),
  true,
  'expected provider execution to complete'
);

await fs.rm(testRoot, { recursive: true, force: true });

console.log('tooling configured paths test passed');
