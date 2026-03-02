#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-diags-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:src/sample.rs:rust-workspace-diagnostics';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-rust-analyzer'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-analyzer',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        uriScheme: 'poc-vfs'
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.rs#seg:rust-workspace-diags.txt',
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-workspace-diags'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_workspace_diags',
      file: 'src/sample.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.rs#seg:rust-workspace-diags.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const checks = result.diagnostics?.['lsp-rust-analyzer']?.checks || [];
assert.ok(Array.isArray(checks), 'expected diagnostics checks for configured rust-analyzer provider');
assert.equal(
  checks.some((check) => check?.name === 'rust-analyzer_workspace_model_missing'),
  true,
  'expected missing Cargo workspace warning when rust workspace markers are absent'
);

console.log('configured LSP rust workspace diagnostics test passed');
