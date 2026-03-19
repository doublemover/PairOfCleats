#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-workspace-module-failed-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');

const goProbeFailScriptPath = path.join(tempRoot, 'go-probe-fail.js');
await fs.writeFile(
  goProbeFailScriptPath,
  'process.stderr.write("forced go workspace module probe failure\\n"); process.exit(17);\n',
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/main.go:go-workspace-module-preflight-failed';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-go-workspace-module-preflight'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'go-workspace-module-preflight',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [goProbeFailScriptPath]
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-module-preflight-failed.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-go-workspace-module-preflight-failed'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_go_workspace_module_preflight_failed',
      file: 'src/main.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-module-preflight-failed.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-go-workspace-module-preflight'] || {};
assert.equal(
  diagnostics?.preflight?.state,
  'blocked',
  'expected go workspace module preflight blocked state when no healthy partition remains'
);
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'go_workspace_blocked_workspace_shape',
  'expected go workspace module preflight blocked workspace-shape reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => String(check?.name || '') === 'go_workspace_module_probe_failed'),
  true,
  'expected go workspace module preflight failed warning check'
);

console.log('configured LSP go workspace module preflight failed test passed');
