#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-zls-workspace-nested-root-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'nested'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'nested', 'build.zig'), 'pub fn build() void {}\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'pub fn add(a: i32, b: i32) i32 { return a + b; }\n';
const chunkUid = 'ck64:v1:test:src/sample.zig:zls-workspace-nested-root';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-zls'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'zls',
        preset: 'zls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'zig'],
        languages: ['zig'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: []
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.zig#seg:zls-workspace-nested-root.txt',
    text: docText,
    languageId: 'zig',
    effectiveExt: '.zig',
    docHash: 'hash-zls-workspace-nested-root'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_zls_workspace_nested_root',
      file: 'src/sample.zig',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.zig#seg:zls-workspace-nested-root.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'zig'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected zls provider to continue with nested workspace marker preflight warning');
const diagnostics = result.diagnostics?.['lsp-zls'] || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected zls preflight degraded state');
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'zls_workspace_nested_root',
  'expected zls nested workspace root reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'zls_workspace_nested_root'),
  true,
  'expected zls nested workspace root warning check'
);

console.log('configured LSP zls workspace nested-root preflight test passed');
