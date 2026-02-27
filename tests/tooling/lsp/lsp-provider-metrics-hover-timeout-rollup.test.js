#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-provider-hover-timeout-rollup-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const cppText = 'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n';
const addStart = cppText.indexOf('add');
const subStart = cppText.indexOf('sub');

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
        args: [serverPath, '--mode', 'stall-signature-help-two-symbols'],
        languages: ['cpp'],
        uriScheme: 'poc-vfs',
        signatureHelpTimeoutMs: 1000,
        hoverDisableAfterTimeouts: 1,
        definitionEnabled: false,
        typeDefinitionEnabled: false,
        referencesEnabled: false
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.cpp#seg:hover-timeout-rollup.cpp',
    text: cppText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-cpp-hover-timeout-rollup'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:hover-timeout-rollup',
      chunkId: 'chunk_metrics_cpp_timeout',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: addStart, end: addStart + 3 }
    },
    virtualPath: '.poc-vfs/src/sample.cpp#seg:hover-timeout-rollup.cpp',
    virtualRange: { start: addStart, end: addStart + 3 },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'cpp'
  }, {
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:hover-timeout-rollup:sub',
      chunkId: 'chunk_metrics_cpp_timeout_sub',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: subStart, end: subStart + 3 }
    },
    virtualPath: '.poc-vfs/src/sample.cpp#seg:hover-timeout-rollup.cpp',
    virtualRange: { start: subStart, end: subStart + 3 },
    symbolHint: { name: 'sub', kind: 'function' },
    languageId: 'cpp'
  }],
  kinds: ['types']
});

assert.equal(
  Number(result.metrics?.hover?.signatureHelpRequested || 0) >= 1,
  true,
  'expected hover rollup signatureHelp request count'
);
assert.equal(
  Number(result.metrics?.hover?.signatureHelpTimedOut || 0) >= 1,
  true,
  'expected hover rollup signatureHelp timeout count'
);
assert.equal(
  Number(result.metrics?.hover?.providersWithActivity || 0) >= 1,
  true,
  'expected hover rollup provider activity count'
);
assert.equal(
  Number(result.metrics?.hover?.skippedByGlobalDisable || 0) >= 1
    || Number(result.metrics?.hover?.skippedByAdaptiveDisable || 0) >= 1,
  true,
  'expected hover rollup adaptive skip counters'
);
assert.equal(
  Number(result.metrics?.providerRuntime?.['lsp-test']?.hover?.signatureHelpTimedOut || 0) >= 1,
  true,
  'expected per-provider hover signatureHelp timeout count'
);
assert.equal(
  Number(result.metrics?.providerRuntime?.['lsp-test']?.hover?.skippedByGlobalDisable || 0) >= 1
    || Number(result.metrics?.providerRuntime?.['lsp-test']?.hover?.skippedByAdaptiveDisable || 0) >= 1,
  true,
  'expected per-provider hover adaptive skip counters'
);

console.log('LSP provider metrics hover timeout rollup test passed');
