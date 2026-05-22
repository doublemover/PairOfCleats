#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runRustAnalyzerWorkspaceFixture } from '../../helpers/lsp-provider-fixture.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-nested-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'workspace', 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'workspace', 'Cargo.toml'),
  '[package]\nname = "nested-workspace"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
const preflightScriptPath = path.join(tempRoot, 'rust-workspace-preflight-ok.js');
await fs.writeFile(preflightScriptPath, 'process.exit(0);\n', 'utf8');

const docText = 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:workspace/src/lib.rs:rust-workspace-nested';
const virtualPath = '.poc-vfs/workspace/src/lib.rs#seg:rust-workspace-nested.txt';

const result = await runRustAnalyzerWorkspaceFixture({
  tempRoot,
  metadataArgs: [preflightScriptPath]
}, {
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-workspace-nested'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_workspace_nested',
      file: 'workspace/src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected rust-analyzer to run when a nested Cargo workspace matches the selected doc');
const checks = result.diagnostics?.['lsp-rust-analyzer']?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'rust_workspace_model_missing'),
  false,
  'expected nested Cargo workspace discovery to avoid missing-workspace warnings'
);

console.log('configured LSP rust workspace nested preflight test passed');
