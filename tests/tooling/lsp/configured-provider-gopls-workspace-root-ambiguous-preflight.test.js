#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-workspace-root-ambiguous-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-a'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'svc-b'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-a', 'go.mod'), 'module example.com/svc-a\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'svc-b', 'go.mod'), 'module example.com/svc-b\n\ngo 1.22\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUidA = 'ck64:v1:test:svc-a/src/sample.go:gopls-workspace-root-ambiguous:a';
const chunkUidB = 'ck64:v1:test:svc-b/src/sample.go:gopls-workspace-root-ambiguous:b';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-gopls'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'gopls',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: []
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [
    {
      virtualPath: '.poc-vfs/svc-a/src/sample.go#seg:gopls-workspace-root-ambiguous-a.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-workspace-root-ambiguous-a'
    },
    {
      virtualPath: '.poc-vfs/svc-b/src/sample.go#seg:gopls-workspace-root-ambiguous-b.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-workspace-root-ambiguous-b'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: chunkUidA,
        chunkId: 'chunk_gopls_workspace_root_ambiguous_a',
        file: 'svc-a/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-a/src/sample.go#seg:gopls-workspace-root-ambiguous-a.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: chunkUidB,
        chunkId: 'chunk_gopls_workspace_root_ambiguous_b',
        file: 'svc-b/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-b/src/sample.go#seg:gopls-workspace-root-ambiguous-b.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUidA), true, 'expected configured gopls provider to route the first module root');
assert.equal(result.byChunkUid.has(chunkUidB), true, 'expected configured gopls provider to route the second module root');
const diagnostics = result.diagnostics?.['lsp-gopls'] || {};
assert.equal(diagnostics?.preflight?.state, 'ready', 'expected gopls preflight ready state');
assert.equal(
  diagnostics?.workspaceModel?.partitionCount,
  2,
  'expected two workspace partitions in diagnostics summary'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'go_workspace_module_root_partitioned'),
  true,
  'expected go workspace partitioned preflight check'
);
assert.equal(
  checks.some((check) => check?.name === 'lsp-gopls_workspace_partition_multi_root'),
  true,
  'expected runtime multi-root workspace routing check'
);

console.log('configured LSP gopls workspace root ambiguous preflight test passed');
