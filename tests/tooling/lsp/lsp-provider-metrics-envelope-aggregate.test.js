#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-provider-metrics-envelope-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const cppText = 'int add(int a, int b) { return a + b; }\n';
const dartText = 'String greet(String name) { return name; }\n';

registerDefaultToolingProviders();
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-test', 'dart'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'test',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'emit-fd-pressure-warning'],
        languages: ['cpp'],
        uriScheme: 'poc-vfs'
      }]
    },
    dart: {
      enabled: true,
      requireWorkspaceModel: false,
      cmd: 'dart-not-found'
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.cpp#seg:metrics-aggregate.cpp',
    text: cppText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-cpp-metrics-aggregate'
  }, {
    virtualPath: '.poc-vfs/src/sample.dart#seg:metrics-aggregate.dart',
    text: dartText,
    languageId: 'dart',
    effectiveExt: '.dart',
    docHash: 'hash-dart-metrics-aggregate'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:metrics-aggregate',
      chunkId: 'chunk_metrics_cpp',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: cppText.length }
    },
    virtualPath: '.poc-vfs/src/sample.cpp#seg:metrics-aggregate.cpp',
    virtualRange: { start: 0, end: cppText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'cpp'
  }, {
    chunkRef: {
      docId: 1,
      chunkUid: 'ck64:v1:test:src/sample.dart:metrics-aggregate',
      chunkId: 'chunk_metrics_dart',
      file: 'src/sample.dart',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: dartText.length }
    },
    virtualPath: '.poc-vfs/src/sample.dart#seg:metrics-aggregate.dart',
    virtualRange: { start: 0, end: dartText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'dart'
  }],
  kinds: ['types']
});

assert.equal(result.metrics?.providersPlanned, 2, 'expected two planned providers');
assert.equal(result.metrics?.providersExecuted, 2, 'expected two executed providers');
assert.equal(result.metrics?.providersContributed, 1, 'expected one contributing provider');
assert.equal(result.metrics?.degradedProviderCount, 1, 'expected one degraded provider');
assert.equal(Number(result.metrics?.degradedWarningChecks || 0) >= 1, true, 'expected degraded warning count');
assert.equal(Number(result.metrics?.requests?.requests || 0) >= 1, true, 'expected request count from active provider');
assert.equal(Number(result.metrics?.health?.fdPressureEvents || 0) >= 1, true, 'expected fd-pressure event rollup');
assert.equal(Number(result.metrics?.health?.providersWithFdPressure || 0) >= 1, true, 'expected fd-pressure provider rollup');
assert.equal(Number(result.metrics?.health?.pooledProviders || 0) >= 1, true, 'expected pooled provider rollup');
assert.equal(result.metrics?.capabilities?.providersWithCapabilitiesMask, 1, 'expected one provider capability mask');
assert.equal(result.metrics?.capabilities?.documentSymbol, 1, 'expected documentSymbol capability rollup');
assert.equal(result.metrics?.capabilities?.hover, 1, 'expected hover capability rollup');
assert.equal(result.metrics?.capabilities?.signatureHelp, 0, 'expected signatureHelp capability rollup');
assert.equal(result.metrics?.capabilities?.definition, 0, 'expected definition capability rollup');
assert.equal(result.metrics?.capabilities?.typeDefinition, 0, 'expected typeDefinition capability rollup');
assert.equal(result.metrics?.capabilities?.references, 0, 'expected references capability rollup');

const runtimeKeys = Object.keys(result.metrics?.providerRuntime || {});
assert.deepEqual(runtimeKeys, ['dart', 'lsp-test'], 'expected deterministic per-provider metrics keys');
assert.equal(result.metrics?.providerRuntime?.dart?.degraded?.active, true, 'expected degraded dart runtime entry');
assert.equal(result.metrics?.providerRuntime?.['lsp-test']?.degraded?.active, false, 'expected active lsp-test runtime entry');
assert.equal(result.metrics?.providerRuntime?.['lsp-test']?.pooling?.enabled, true, 'expected pooling state in runtime entry');
assert.equal(result.metrics?.providerRuntime?.['lsp-test']?.pooling?.sessionKeyPresent, true, 'expected pooled session key');
assert.equal(
  result.metrics?.providerRuntime?.['lsp-test']?.capabilities?.documentSymbol,
  true,
  'expected lsp-test capability mask in metrics envelope'
);

console.log('LSP provider metrics envelope aggregate test passed');
