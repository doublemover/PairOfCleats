#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-workspace-preflight-block-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/sample.go:workspace-preflight-block';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-custom-ws'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'custom-ws',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        uriScheme: 'poc-vfs',
        workspaceMarkerOptions: {
          exactNames: ['go.mod']
        },
        workspaceModelPolicy: 'block',
        workspaceModelMissingMessage: 'custom workspace marker missing.'
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.go#seg:workspace-preflight-block.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-workspace-preflight-block'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_workspace_preflight_block',
      file: 'src/sample.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.go#seg:workspace-preflight-block.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected provider to be blocked by workspace preflight');
const checks = result.diagnostics?.['lsp-custom-ws']?.checks || [];
assert.ok(Array.isArray(checks), 'expected diagnostics checks for configured provider');
assert.equal(
  checks.some((check) => check?.name === 'custom-ws_workspace_model_missing'),
  true,
  'expected custom workspace-model missing preflight check'
);
assert.equal(
  checks.some((check) => check?.name === 'lsp_command_unavailable'),
  false,
  'expected command profile probe checks to be skipped when preflight blocks provider'
);

console.log('configured LSP workspace preflight block test passed');
