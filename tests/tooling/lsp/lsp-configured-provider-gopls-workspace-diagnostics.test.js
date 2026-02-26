#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-workspace-diags-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/sample.go:gopls-workspace-diagnostics';

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
        uriScheme: 'poc-vfs'
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.go#seg:gopls-workspace-diags.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-gopls-workspace-diags'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_gopls_workspace_diags',
      file: 'src/sample.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.go#seg:gopls-workspace-diags.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
});

const checks = result.diagnostics?.['lsp-gopls']?.checks || [];
assert.ok(Array.isArray(checks), 'expected diagnostics checks for configured gopls provider');
assert.equal(
  checks.some((check) => check?.name === 'gopls_workspace_model_missing'),
  true,
  'expected missing go.mod/go.work warning when workspace markers are absent'
);

console.log('configured LSP gopls workspace diagnostics test passed');
