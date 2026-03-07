#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-workspace-warmup-doc-gating-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'main.go'), 'package main\nfunc Add(a int, b int) int { return a + b }\n', 'utf8');

const modulePassScriptPath = path.join(tempRoot, 'go-module-pass.js');
await fs.writeFile(modulePassScriptPath, "process.stdout.write('ok\\n');\n", 'utf8');

const warmupFailScriptPath = path.join(tempRoot, 'go-warmup-fail.js');
await fs.writeFile(
  warmupFailScriptPath,
  "process.stderr.write('warmup should not run\\n'); process.exit(19);\n",
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/main.go:go-workspace-warmup-doc-gating';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-go-workspace-warmup-doc-gating'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'go-workspace-warmup-doc-gating',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [modulePassScriptPath],
        goWorkspaceWarmup: true,
        goWorkspaceWarmupMinGoFiles: 5,
        goWorkspaceWarmupCmd: process.execPath,
        goWorkspaceWarmupArgs: [warmupFailScriptPath]
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-warmup-doc-gating.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-go-workspace-warmup-doc-gating'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_go_workspace_warmup_doc_gating',
      file: 'src/main.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-warmup-doc-gating.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-go-workspace-warmup-doc-gating'] || {};
assert.equal(diagnostics?.preflight?.state, 'ready', 'expected warmup gating to keep gopls preflight ready');
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => String(check?.name || '').startsWith('go_workspace_warmup_probe_')),
  false,
  'expected doc-count gate to skip go workspace warmup subprocess'
);

console.log('configured LSP go workspace warmup doc-count gating test passed');
