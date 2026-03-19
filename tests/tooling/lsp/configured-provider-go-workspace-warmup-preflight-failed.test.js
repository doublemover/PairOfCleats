#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-workspace-warmup-failed-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'main.go'), 'package main\nfunc Add(a int, b int) int { return a + b }\n', 'utf8');

const goProbePassScriptPath = path.join(tempRoot, 'go-probe-pass.js');
await fs.writeFile(
  goProbePassScriptPath,
  'process.stdout.write("example.com/preflight\\n"); process.exit(0);\n',
  'utf8'
);

const goWarmupFailScriptPath = path.join(tempRoot, 'go-warmup-fail.js');
await fs.writeFile(
  goWarmupFailScriptPath,
  'process.stderr.write("forced go workspace warmup failure\\n"); process.exit(19);\n',
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/main.go:go-workspace-warmup-preflight-failed';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-go-workspace-warmup-preflight'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'go-workspace-warmup-preflight',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [goProbePassScriptPath],
        goWorkspaceWarmup: true,
        goWorkspaceWarmupMinGoFiles: 1,
        goWorkspaceWarmupCmd: process.execPath,
        goWorkspaceWarmupArgs: [goWarmupFailScriptPath]
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-warmup-preflight-failed.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-go-workspace-warmup-preflight-failed'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_go_workspace_warmup_preflight_failed',
      file: 'src/main.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-warmup-preflight-failed.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-go-workspace-warmup-preflight'] || {};
assert.equal(
  diagnostics?.preflight?.state,
  'blocked',
  'expected go workspace warmup preflight blocked state when no healthy partition remains'
);
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'go_workspace_blocked_workspace_shape',
  'expected go workspace warmup preflight blocked workspace-shape reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => String(check?.name || '') === 'go_workspace_warmup_probe_failed'),
  true,
  'expected go workspace warmup preflight warning check'
);

console.log('configured LSP go workspace warmup preflight failed test passed');
