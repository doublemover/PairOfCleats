#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-root-ambiguous-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'crate-a', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'crate-b', 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'crate-a', 'Cargo.toml'),
  '[package]\nname = "crate-a"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'crate-b', 'Cargo.toml'),
  '[package]\nname = "crate-b"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
const preflightScriptPath = path.join(tempRoot, 'rust-workspace-preflight-ok.js');
await fs.writeFile(preflightScriptPath, 'process.exit(0);\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUidA = 'ck64:v1:test:crate-a/src/lib.rs:rust-workspace-root-ambiguous:a';
const chunkUidB = 'ck64:v1:test:crate-b/src/lib.rs:rust-workspace-root-ambiguous:b';

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
        uriScheme: 'poc-vfs',
        rustWorkspaceMetadataCmd: process.execPath,
        rustWorkspaceMetadataArgs: [preflightScriptPath]
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [
    {
      virtualPath: '.poc-vfs/crate-a/src/lib.rs#seg:rust-workspace-root-ambiguous-a.txt',
      text: docText,
      languageId: 'rust',
      effectiveExt: '.rs',
      docHash: 'hash-rust-workspace-root-ambiguous-a'
    },
    {
      virtualPath: '.poc-vfs/crate-b/src/lib.rs#seg:rust-workspace-root-ambiguous-b.txt',
      text: docText,
      languageId: 'rust',
      effectiveExt: '.rs',
      docHash: 'hash-rust-workspace-root-ambiguous-b'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: chunkUidA,
        chunkId: 'chunk_rust_workspace_root_ambiguous_a',
        file: 'crate-a/src/lib.rs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/crate-a/src/lib.rs#seg:rust-workspace-root-ambiguous-a.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'rust'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: chunkUidB,
        chunkId: 'chunk_rust_workspace_root_ambiguous_b',
        file: 'crate-b/src/lib.rs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/crate-b/src/lib.rs#seg:rust-workspace-root-ambiguous-b.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'rust'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUidA), true, 'expected rust-analyzer to route the first workspace root');
assert.equal(result.byChunkUid.has(chunkUidB), true, 'expected rust-analyzer to route the second workspace root');
const diagnostics = result.diagnostics?.['lsp-rust-analyzer'] || {};
assert.equal(diagnostics?.workspaceModel?.partitionCount, 2, 'expected two workspace partitions in diagnostics summary');
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'rust_workspace_root_partitioned'),
  true,
  'expected rust workspace partitioned preflight check'
);
assert.equal(
  checks.some((check) => check?.name === 'lsp-rust-analyzer_workspace_partition_multi_root'),
  true,
  'expected runtime multi-root workspace routing check'
);

console.log('configured LSP rust workspace root ambiguous partition test passed');
