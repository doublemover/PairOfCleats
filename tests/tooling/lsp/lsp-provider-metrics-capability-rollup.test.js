#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-provider-capability-rollup-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const cppText = 'int add(int a, int b) { return a + b; }\n';

registerDefaultToolingProviders();
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-test'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'test',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'all-capabilities'],
        languages: ['cpp'],
        uriScheme: 'poc-vfs'
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.cpp#seg:capability-rollup.cpp',
    text: cppText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-cpp-capability-rollup'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:capability-rollup',
      chunkId: 'chunk_metrics_cpp',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: cppText.length }
    },
    virtualPath: '.poc-vfs/src/sample.cpp#seg:capability-rollup.cpp',
    virtualRange: { start: 0, end: cppText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'cpp'
  }],
  kinds: ['types']
});

assert.equal(result.metrics?.capabilities?.providersWithCapabilitiesMask, 1, 'expected one provider capability mask');
assert.equal(result.metrics?.capabilities?.documentSymbol, 1, 'expected documentSymbol capability rollup');
assert.equal(result.metrics?.capabilities?.hover, 1, 'expected hover capability rollup');
assert.equal(result.metrics?.capabilities?.signatureHelp, 1, 'expected signatureHelp capability rollup');
assert.equal(result.metrics?.capabilities?.definition, 1, 'expected definition capability rollup');
assert.equal(result.metrics?.capabilities?.typeDefinition, 1, 'expected typeDefinition capability rollup');
assert.equal(result.metrics?.capabilities?.references, 1, 'expected references capability rollup');

const providerCapabilities = result.metrics?.providerRuntime?.['lsp-test']?.capabilities || null;
assert.equal(providerCapabilities?.definition, true, 'expected provider definition capability');
assert.equal(providerCapabilities?.typeDefinition, true, 'expected provider typeDefinition capability');
assert.equal(providerCapabilities?.references, true, 'expected provider references capability');

console.log('LSP provider metrics capability rollup test passed');
