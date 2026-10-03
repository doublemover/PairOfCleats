#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildCliContextPackRequestInput,
  buildContextPackRequestInput
} from '../../src/shared/context-pack-request.js';

const source = {
  seed: 'chunk:abc123',
  hops: 2,
  includeGraph: false,
  includeTypes: true,
  includeRisk: true,
  includeRiskPartialFlows: true,
  strictRisk: true,
  strictEvidence: true,
  filters: {
    severity: 'high',
    sourceRule: 'source.request'
  },
  includeImports: false,
  includeUsages: true,
  includeCallersCallees: false,
  includePaths: true,
  maxBytes: 4096,
  maxTokens: 512,
  maxTypeEntries: 8,
  maxDepth: 3,
  maxFanoutPerNode: 4,
  maxNodes: 30,
  maxEdges: 40,
  maxPaths: 5,
  maxCandidates: 20,
  maxWorkUnits: 100,
  maxWallClockMs: 2500,
  workspacePath: 'C:\\workspace\\.pairofcleats-workspace.jsonc',
  workspaceId: 'workspace-test',
  select: {
    repoFilter: ['alpha']
  },
  repoFilter: 'ignored-top-level-api-filter',
  includeDisabled: true,
  maxFederatedRepos: 2
};

const workspaceConfig = {
  repoSetId: 'workspace-test',
  workspacePath: source.workspacePath,
  repos: []
};

const apiRequest = buildContextPackRequestInput(source, {
  repoRoot: 'C:\\repo',
  riskFilters: source.filters || null,
  workspaceConfig
});

assert.equal(apiRequest.repoRoot, 'C:\\repo');
assert.equal(apiRequest.seed, source.seed);
assert.equal(apiRequest.hops, source.hops);
assert.equal(apiRequest.includeRiskPartialFlows, true);
assert.equal(apiRequest.strictEvidence, true);
assert.deepEqual(apiRequest.riskFilters, source.filters);
assert.equal(apiRequest.workspacePath, source.workspacePath);
assert.equal(apiRequest.workspaceId, source.workspaceId);
assert.deepEqual(apiRequest.select, source.select);
assert.equal(apiRequest.includeDisabled, true);
assert.equal(apiRequest.maxFederatedRepos, 2);
assert.equal(apiRequest.workspaceConfig, workspaceConfig);
assert.equal(
  Object.hasOwn(apiRequest, 'repoFilter'),
  false,
  'API/MCP projection should not add top-level repoFilter unless a surface explicitly opts in'
);

const mcpRequest = buildContextPackRequestInput(source, {
  repoRoot: 'C:\\repo',
  riskFilters: source.filters || null
});

assert.deepEqual(
  {
    ...mcpRequest,
    workspaceConfig
  },
  apiRequest,
  'API and MCP projections should match for shared context-pack request fields'
);

const cliRequest = buildCliContextPackRequestInput({
  seed: 'symbol:render',
  hops: 1,
  includeRisk: true,
  includeRiskPartialFlows: true,
  workspace: 'C:\\workspace\\.pairofcleats-workspace.jsonc',
  workspaceId: 'workspace-test',
  select: ['alpha'],
  'repo-filter': 'alpha',
  includeDisabled: true,
  maxFederatedRepos: 3,
  severity: 'critical',
  'source-rule': 'source.request',
  'flow-id': 'flow-1'
}, {
  repoRoot: 'C:\\repo'
});

assert.equal(cliRequest.repoRoot, 'C:\\repo');
assert.equal(cliRequest.workspacePath, 'C:\\workspace\\.pairofcleats-workspace.jsonc');
assert.equal(cliRequest.repoFilter, 'alpha');
assert.deepEqual(cliRequest.select, ['alpha']);
assert.equal(cliRequest.includeDisabled, true);
assert.equal(cliRequest.maxFederatedRepos, 3);
assert.deepEqual(cliRequest.riskFilters, {
  rule: undefined,
  category: undefined,
  severity: 'critical',
  tag: undefined,
  source: undefined,
  sink: undefined,
  flowId: 'flow-1',
  sourceRule: 'source.request',
  sinkRule: undefined
});

console.log('context-pack request contract test passed');
