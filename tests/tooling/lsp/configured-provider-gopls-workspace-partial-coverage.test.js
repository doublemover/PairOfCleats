#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-workspace-partial-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-ok', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'svc-bad', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-ok', 'go.mod'), 'module example.com/svc-ok\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'svc-bad', 'go.mod'), 'module example.com/svc-bad\n\ngo 1.22\n', 'utf8');

const selectiveProbePath = path.join(tempRoot, 'go-probe-selective.js');
await fs.writeFile(
  selectiveProbePath,
  [
    "import path from 'node:path';",
    "const cwd = process.cwd();",
    "if (path.basename(cwd) === 'svc-bad') {",
    "  process.stderr.write('forced blocked workspace partition\\n');",
    '  process.exit(19);',
    '}',
    "process.stdout.write('ok\\n');"
  ].join('\n'),
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUidOk = 'ck64:v1:test:svc-ok/src/sample.go:gopls-workspace-partial:ok';
const chunkUidBad = 'ck64:v1:test:svc-bad/src/sample.go:gopls-workspace-partial:bad';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-gopls'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'gopls',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [selectiveProbePath],
        goWorkspaceWarmup: false
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [
    {
      virtualPath: '.poc-vfs/svc-ok/src/sample.go#seg:gopls-workspace-partial-ok.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-workspace-partial-ok'
    },
    {
      virtualPath: '.poc-vfs/svc-bad/src/sample.go#seg:gopls-workspace-partial-bad.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-workspace-partial-bad'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: chunkUidOk,
        chunkId: 'chunk_gopls_workspace_partial_ok',
        file: 'svc-ok/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-ok/src/sample.go#seg:gopls-workspace-partial-ok.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: chunkUidBad,
        chunkId: 'chunk_gopls_workspace_partial_bad',
        file: 'svc-bad/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-bad/src/sample.go#seg:gopls-workspace-partial-bad.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUidOk), true, 'expected healthy gopls partition to contribute');
assert.equal(result.byChunkUid.has(chunkUidBad), false, 'expected blocked gopls partition to be isolated');
const diagnostics = result.diagnostics?.['lsp-gopls'] || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected mixed partition preflight degraded state');
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'go_workspace_partial_repo_coverage',
  'expected partial coverage reason code for mixed healthy and blocked partitions'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'go_workspace_partial_repo_coverage'),
  true,
  'expected partial coverage check for mixed partition repo'
);
assert.equal(
  checks.some((check) => check?.name === 'lsp-gopls_workspace_partition_blocked'),
  true,
  'expected runtime blocked partition check'
);

console.log('configured LSP gopls workspace partial coverage test passed');
