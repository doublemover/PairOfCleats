#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-proc-macro-policy-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'Cargo.toml'), '[package]\nname = "poc-rust-proc-macro-policy"\nversion = "0.1.0"\nedition = "2021"\n');
await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), 'fn add(a: i32, b: i32) -> i32 { a + b }\n');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:src/sample.rs:rust-proc-macro-policy-preflight';

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
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        uriScheme: 'poc-vfs',
        rustSuppressProcMacroDiagnostics: true,
        preflightRuntimeRequirements: []
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.rs#seg:rust-proc-macro-policy-preflight.txt',
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-proc-macro-policy-preflight'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_proc_macro_policy_preflight',
      file: 'src/sample.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.rs#seg:rust-proc-macro-policy-preflight.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected rust provider to continue with proc-macro suppression policy warning');
const diagnostics = result.diagnostics?.['lsp-rust-analyzer'] || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected rust preflight degraded state');
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'rust_workspace_proc_macro_suppression_active',
  'expected rust proc-macro suppression policy reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'rust_workspace_proc_macro_suppression_active'),
  true,
  'expected rust proc-macro suppression policy warning check'
);

console.log('configured LSP rust proc-macro suppression policy preflight test passed');
