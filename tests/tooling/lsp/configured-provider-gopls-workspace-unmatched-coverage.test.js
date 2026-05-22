#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  buildGoplsWorkspaceContext,
  buildGoplsWorkspaceInputs,
  goplsSampleDocText
} from './helpers/gopls-workspace-case.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-workspace-unmatched-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-ok', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'rogue', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-ok', 'go.mod'), 'module example.com/svc-ok\n\ngo 1.22\n', 'utf8');

const okProbePath = path.join(tempRoot, 'go-probe-ok.js');
await fs.writeFile(okProbePath, "process.stdout.write('ok\\n');\n", 'utf8');

const inputs = buildGoplsWorkspaceInputs({
  scenario: 'gopls-workspace-unmatched',
  docText: goplsSampleDocText,
  partitions: [
    { key: 'ok', service: 'svc-ok', suffix: 'ok' },
    { key: 'rogue', service: 'rogue', suffix: 'rogue' }
  ]
});

const result = await runToolingProviders(
  buildGoplsWorkspaceContext({ root, tempRoot, probePath: okProbePath }),
  inputs
);

assert.equal(result.byChunkUid.has(inputs.chunkUids.ok), true, 'expected matched gopls partition to contribute');
assert.equal(result.byChunkUid.has(inputs.chunkUids.rogue), false, 'expected unmatched Go workspace target to remain excluded');

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
