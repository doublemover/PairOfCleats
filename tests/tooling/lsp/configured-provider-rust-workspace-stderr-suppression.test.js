#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-stderr-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'Cargo.toml'),
  '[package]\nname = "root"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
const preflightScriptPath = path.join(tempRoot, 'rust-workspace-preflight-ok.js');
await fs.writeFile(preflightScriptPath, 'process.exit(0);\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const logLines = [];
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  logger: (line) => {
    logLines.push(String(line || ''));
  },
  toolingConfig: {
    enabledTools: ['lsp-rust-analyzer'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-analyzer',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust-workspace-noise'],
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
  documents: [{
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-stderr.txt',
    text: 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-workspace-stderr'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/lib.rs:rust-workspace-stderr',
      chunkId: 'chunk_rust_workspace_stderr',
      file: 'src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 46 }
    },
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-stderr.txt',
    virtualRange: { start: 0, end: 46 },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const checks = result.diagnostics?.['lsp-rust-analyzer']?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'rust_workspace_repo_invalidity'),
  true,
  'expected repo-invalidity stderr suppression check'
);
assert.equal(
  checks.some((check) => check?.name === 'rust_workspace_toolchain_metadata_noise'),
  true,
  'expected toolchain-noise stderr suppression check'
);
assert.equal(
  logLines.some((line) => line.includes('rust-analyzer suppressed 4 duplicate workspace stderr line(s)')),
  true,
  'expected aggregated rust-analyzer stderr suppression log line'
);
assert.equal(
  logLines.some((line) => line.includes('failed to find a workspace root for examples/broken/Cargo.toml')),
  false,
  'expected raw duplicate workspace root stderr line to be suppressed from logs'
);

console.log('configured LSP rust workspace stderr suppression test passed');
