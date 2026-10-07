#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-go-work-multi-root-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-a', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'svc-b', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.work'), 'go 1.22\n\nuse ./svc-a\nuse ./svc-b\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'svc-a', 'go.mod'), 'module example.com/svc-a\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'svc-b', 'go.mod'), 'module example.com/svc-b\n\ngo 1.22\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUidA = 'ck64:v1:test:svc-a/src/sample.go:gopls-go-work-multi-root:a';
const chunkUidB = 'ck64:v1:test:svc-b/src/sample.go:gopls-go-work-multi-root:b';

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
        preflightRuntimeRequirements: [],
        goWorkspaceWarmup: false
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [
    {
      virtualPath: '.poc-vfs/svc-a/src/sample.go#seg:gopls-go-work-multi-root-a.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-go-work-multi-root-a'
    },
    {
      virtualPath: '.poc-vfs/svc-b/src/sample.go#seg:gopls-go-work-multi-root-b.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-go-work-multi-root-b'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: chunkUidA,
        chunkId: 'chunk_gopls_go_work_multi_root_a',
        file: 'svc-a/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-a/src/sample.go#seg:gopls-go-work-multi-root-a.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: chunkUidB,
        chunkId: 'chunk_gopls_go_work_multi_root_b',
        file: 'svc-b/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-b/src/sample.go#seg:gopls-go-work-multi-root-b.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUidA), true, 'expected first go.work partition to contribute');
assert.equal(result.byChunkUid.has(chunkUidB), true, 'expected second go.work partition to contribute');
const diagnostics = result.diagnostics?.['lsp-gopls'] || {};
assert.equal(diagnostics?.preflight?.state, 'ready', 'expected go.work multi-root preflight ready state');
assert.equal(
  diagnostics?.workspaceModel?.partitionCount,
  2,
  'expected go.work multi-root workspace summary to expose both partitions'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'go_workspace_module_root_partitioned'),
  true,
  'expected go workspace partitioned preflight check for go.work repo'
);

console.log('configured LSP gopls go.work multi-root test passed');
