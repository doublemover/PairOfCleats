#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-workspace-unmatched-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-ok', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'rogue', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-ok', 'go.mod'), 'module example.com/svc-ok\n\ngo 1.22\n', 'utf8');

const okProbePath = path.join(tempRoot, 'go-probe-ok.js');
await fs.writeFile(okProbePath, "process.stdout.write('ok\\n');\n", 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUidOk = 'ck64:v1:test:svc-ok/src/sample.go:gopls-workspace-unmatched:ok';
const chunkUidRogue = 'ck64:v1:test:rogue/src/sample.go:gopls-workspace-unmatched:rogue';

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
        goWorkspaceModuleArgs: [okProbePath],
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
      virtualPath: '.poc-vfs/svc-ok/src/sample.go#seg:gopls-workspace-unmatched-ok.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-workspace-unmatched-ok'
    },
    {
      virtualPath: '.poc-vfs/rogue/src/sample.go#seg:gopls-workspace-unmatched-rogue.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-gopls-workspace-unmatched-rogue'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: chunkUidOk,
        chunkId: 'chunk_gopls_workspace_unmatched_ok',
        file: 'svc-ok/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/svc-ok/src/sample.go#seg:gopls-workspace-unmatched-ok.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: chunkUidRogue,
        chunkId: 'chunk_gopls_workspace_unmatched_rogue',
        file: 'rogue/src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/rogue/src/sample.go#seg:gopls-workspace-unmatched-rogue.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUidOk), true, 'expected matched gopls partition to contribute');
assert.equal(result.byChunkUid.has(chunkUidRogue), false, 'expected unmatched Go workspace target to remain excluded');

const diagnostics = result.diagnostics?.['lsp-gopls'] || {};
assert.equal(diagnostics?.fidelity?.state, 'degraded', 'expected unmatched mixed coverage to be degraded');
assert.equal(diagnostics?.fidelity?.qualityDelta?.partialSuccess, true, 'expected matched partition to preserve partial success');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.readyPartitionCount, 1, 'expected one ready partition');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.blockedPartitionCount, 0, 'expected no blocked partitions');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.unmatchedDocumentCount, 1, 'expected unmatched document count');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.unmatchedTargetCount, 1, 'expected unmatched target count');
assert.equal(
  Array.isArray(diagnostics?.fidelity?.runtimeIssues)
  && diagnostics.fidelity.runtimeIssues.includes('partial_workspace_coverage')
  && diagnostics.fidelity.runtimeIssues.includes('unmatched_workspace_documents')
  && diagnostics.fidelity.runtimeIssues.includes('unmatched_workspace_targets'),
  true,
  'expected fidelity runtime issues to expose unmatched workspace coverage loss'
);

const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'lsp-gopls_workspace_partition_incomplete'),
  true,
  'expected explicit unmatched workspace partition check'
);

console.log('configured LSP gopls workspace unmatched coverage test passed');
