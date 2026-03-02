#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-metadata-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

// Intentionally invalid Cargo.toml to force `cargo metadata` preflight failure.
await fs.writeFile(path.join(tempRoot, 'Cargo.toml'), '[package\nname = "broken"\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:src/lib.rs:rust-workspace-metadata-preflight';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-rust-metadata-preflight'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-metadata-preflight',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        // Keep this test focused on cargo-metadata preflight classification.
        preflightRuntimeRequirements: []
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-metadata-preflight.txt',
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-workspace-metadata-preflight'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_workspace_metadata_preflight',
      file: 'src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-metadata-preflight.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-rust-metadata-preflight'] || {};
assert.equal(
  diagnostics?.preflight?.state,
  'degraded',
  'expected rust workspace metadata preflight degraded state'
);
assert.equal(
  ['rust_workspace_metadata_failed', 'rust_workspace_metadata_error', 'rust_workspace_metadata_timeout']
    .includes(String(diagnostics?.preflight?.reasonCode || '')),
  true,
  'expected rust workspace metadata preflight reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => String(check?.name || '').startsWith('rust_workspace_metadata_')),
  true,
  'expected rust workspace metadata preflight warning check'
);

console.log('configured LSP rust workspace metadata preflight degraded test passed');
