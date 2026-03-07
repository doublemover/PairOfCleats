#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-metadata-timeout-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'Cargo.toml'),
  '[package]\nname = "sample"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);

const rustProbeHangScriptPath = path.join(tempRoot, 'rust-metadata-timeout.js');
await fs.writeFile(rustProbeHangScriptPath, 'setTimeout(() => process.exit(0), 5000);\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:src/lib.rs:rust-workspace-metadata-timeout-override';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-rust-metadata-timeout'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-metadata-timeout',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        preflightRuntimeRequirements: [],
        rustWorkspaceMetadataCmd: process.execPath,
        rustWorkspaceMetadataArgs: [rustProbeHangScriptPath],
        rustWorkspaceMetadataTimeoutMs: 500
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-metadata-timeout-override.txt',
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-workspace-metadata-timeout-override'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_workspace_metadata_timeout_override',
      file: 'src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-metadata-timeout-override.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-rust-metadata-timeout'] || {};
assert.equal(
  diagnostics?.preflight?.state,
  'degraded',
  'expected rust metadata timeout override preflight degraded state'
);
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'rust_workspace_metadata_timeout',
  'expected rust metadata timeout override reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => String(check?.name || '') === 'rust_workspace_metadata_timeout'),
  true,
  'expected rust metadata timeout override warning check'
);

console.log('configured LSP rust workspace metadata timeout override test passed');
