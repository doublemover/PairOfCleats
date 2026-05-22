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

const inputs = buildGoplsWorkspaceInputs({
  scenario: 'gopls-workspace-partial',
  docText: goplsSampleDocText,
  partitions: [
    { key: 'ok', service: 'svc-ok', suffix: 'ok' },
    { key: 'bad', service: 'svc-bad', suffix: 'bad' }
  ]
});

const result = await runToolingProviders(
  buildGoplsWorkspaceContext({ root, tempRoot, probePath: selectiveProbePath }),
  inputs
);

assert.equal(result.byChunkUid.has(inputs.chunkUids.ok), true, 'expected healthy gopls partition to contribute');
assert.equal(result.byChunkUid.has(inputs.chunkUids.bad), false, 'expected blocked gopls partition to be isolated');
const diagnostics = result.diagnostics?.['lsp-gopls'] || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected mixed partition preflight degraded state');
assert.equal(diagnostics?.fidelity?.state, 'degraded', 'expected fidelity contract to classify partial workspace coverage as degraded');
assert.equal(diagnostics?.fidelity?.qualityDelta?.partialSuccess, true, 'expected mixed partition coverage to report partial success');
assert.equal(diagnostics?.fidelity?.semanticCoverage?.state, 'partial', 'expected mixed partition coverage semantic state');
assert.equal(diagnostics?.fidelity?.requestSuppression?.active, true, 'expected partial workspace request suppression to be explicit');
assert.equal(diagnostics?.fidelity?.blockedPartitions?.count, 1, 'expected blocked partition count to be surfaced');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.totalPartitions, 2, 'expected total partition count to be surfaced');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.readyPartitionCount, 1, 'expected ready partition count to be surfaced');
assert.equal(diagnostics?.fidelity?.workspaceCoverage?.blockedPartitionCount, 1, 'expected blocked partition count in workspace coverage');
assert.equal(diagnostics?.fidelity?.contributes?.typeEnrichment, true, 'expected healthy partitions to remain contributory');
assert.equal(
  Array.isArray(diagnostics?.fidelity?.runtimeIssues)
  && diagnostics.fidelity.runtimeIssues.includes('partial_workspace_coverage')
  && diagnostics.fidelity.runtimeIssues.includes('blocked_workspace_partitions'),
  true,
  'expected fidelity contract to expose shared workspace-partition runtime issue classes'
);
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
assert.equal(
  checks.some((check) => check?.name === 'lsp-gopls_workspace_partition_partial_success'),
  true,
  'expected runtime partial-success check for mixed partition repo'
);
assert.equal(
  Array.isArray(result.degradedProviders)
  && result.degradedProviders.some((entry) => entry?.providerId === 'lsp-gopls' && entry?.partialSuccess === true),
  true,
  'expected partial-success gopls run to remain visible in degraded provider rollups'
);
assert.equal(result.metrics?.degradedProviderCount, 1, 'expected degraded provider metrics to include partial-success gopls');
assert.equal(
  Array.isArray(result.observations)
  && result.observations.some((entry) => entry?.code === 'tooling_provider_degraded_mode' && entry?.context?.providerId === 'lsp-gopls'),
  true,
  'expected degraded provider observation for partial-success gopls coverage loss'
);

console.log('configured LSP gopls workspace partial coverage test passed');
