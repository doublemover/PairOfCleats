#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-proc-macro-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:src/sample.rs:rust-proc-macro-diagnostics';

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
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust-diagnostics-proc-macro'],
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
    virtualPath: '.poc-vfs/src/sample.rs#seg:rust-proc-macro.txt',
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-proc-macro'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_proc_macro',
      file: 'src/sample.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.rs#seg:rust-proc-macro.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-rust-analyzer'];
assert.ok(diagnostics, 'expected configured rust provider diagnostics payload');
assert.equal(diagnostics.diagnosticsCount, 1, 'expected non-fatal proc-macro warning to be suppressed');
const chunkDiagnostics = diagnostics.diagnosticsByChunkUid?.[chunkUid] || [];
assert.equal(chunkDiagnostics.length, 1, 'expected one remaining diagnostic after suppression');
assert.equal(chunkDiagnostics[0]?.severity, 1, 'expected fatal diagnostic to remain');
assert.equal(
  (diagnostics.checks || []).some((check) => check?.name === 'tooling_rust_proc_macro_diagnostics_suppressed'),
  true,
  'expected suppression check in diagnostics payload'
);

console.log('configured LSP rust proc-macro diagnostic suppression test passed');
