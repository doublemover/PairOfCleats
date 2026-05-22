#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import {
  buildRiskCallSite,
  buildRiskFlow,
  buildRiskPiecesManifestFields,
  buildRiskStatsFields,
  buildRiskSummary,
  createRiskRepoIndexFixture,
  findRiskQueryOffset,
  writeJsonl
} from '../helpers/risk-pack-eval.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream/json-writers.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { handleToolCall } from '../../tools/mcp/tools.js';
import { writeFederatedWorkspaceConfig, startFederatedApiServer } from '../helpers/federated-api.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-federated-risk');
const cacheRoot = path.join(tempRoot, 'cache');
const workspaceDir = path.join(tempRoot, 'workspace');
const workspacePath = path.join(workspaceDir, '.pairofcleats-workspace.jsonc');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const riskSeed = 'chunk:chunk-risk';
const federatedRiskGeneratedAt = '2026-03-19T12:00:00.000Z';
const federatedRiskCompatibilityKey = 'compat-federated-risk';

const buildRiskRepo = async (repoPath, alias, priority) => {
  const sourceText = `export function ${alias}Risk(input) {\n  return query(input);\n}\n`;
  const fileRelPath = `src/${alias}.js`;
  const { finalIndexDir } = await createRiskRepoIndexFixture({
    repoPath,
    cacheRoot,
    fileRelPath,
    sourceText,
    alias,
    generatedAt: federatedRiskGeneratedAt,
    compatibilityKey: federatedRiskCompatibilityKey
  });

  const queryOffset = findRiskQueryOffset(sourceText);
  const flowId = `sha1:${alias[0].repeat(40)}`;

  await writeJsonObjectFile(path.join(finalIndexDir, 'risk_interprocedural_stats.json'), buildRiskStatsFields({
    generatedAt: federatedRiskGeneratedAt,
    flowsEmitted: 1,
    uniqueCallSitesReferenced: 1,
    maxCallSitesPerEdge: 1
  }));
  await writeJsonl(path.join(finalIndexDir, 'risk_summaries.jsonl'), [buildRiskSummary({
    fileRelPath,
    languageId: 'javascript',
    symbolName: `${alias}Risk`,
    symbolKind: 'FunctionDeclaration',
    signature: `${alias}Risk(input)`
  })]);
  await writeJsonl(path.join(finalIndexDir, 'risk_flows.jsonl'), [buildRiskFlow({
    alias,
    flowId,
    confidence: priority >= 10 ? 0.95 : 0.85
  })]);
  await writeJsonl(path.join(finalIndexDir, 'call_sites.jsonl'), [buildRiskCallSite({
    callSiteId: `cs-${alias}`,
    fileRelPath,
    languageId: 'javascript',
    queryOffset
  })]);
  await writeJsonObjectFile(path.join(finalIndexDir, 'pieces', 'manifest.json'), buildRiskPiecesManifestFields({
    compatibilityKey: federatedRiskCompatibilityKey,
    generatedAt: federatedRiskGeneratedAt,
    stage: 'context-pack-federated-risk-test'
  }));

  return {
    repoPath,
    alias,
    flowId
  };
};

const normalizeRiskProjection = (payload) => ({
  selectedRepos: payload?.risk?.federation?.selection?.selectedRepos?.map((repo) => repo.alias) || [],
  skippedRepos: payload?.risk?.federation?.skippedRepos?.map((repo) => repo.alias) || [],
  flows: Array.isArray(payload?.risk?.flows)
    ? payload.risk.flows.map((flow) => ({
      flowId: flow.flowId,
      repoAlias: flow.repo?.alias || null,
      sourceAlias: flow.source?.repo?.alias || null,
      sinkAlias: flow.sink?.repo?.alias || null,
      nodeAliases: Array.isArray(flow.path?.nodes) ? flow.path.nodes.map((node) => node.repo?.alias || null) : [],
      evidenceAliases: Array.isArray(flow.evidence?.callSitesByStep)
        ? flow.evidence.callSitesByStep.flat().map((entry) => entry?.details?.repo?.alias || null)
        : []
    }))
    : []
});

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(workspaceDir, { recursive: true });
await buildRiskRepo(repoA, 'alpha', 10);
await buildRiskRepo(repoB, 'beta', 5);
await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  cacheRoot,
  repos: [
    { root: repoA, alias: 'alpha', priority: 10, tags: ['team-a'] },
    { root: repoB, alias: 'beta', priority: 5, tags: ['team-b'] }
  ]
});
const workspaceConfig = loadWorkspaceConfig(workspacePath);
const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot: repoA,
  allowedRoots: [tempRoot],
  envOverrides: process.env
});
try {
  const baseArgs = {
    repoPath: repoA,
    workspacePath,
    workspaceId: workspaceConfig.repoSetId,
    seed: riskSeed,
    hops: 0,
    includeRisk: true,
    includeGraph: false,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false
  };

  const singleRepoArgs = {
    ...baseArgs,
    select: {
      repoFilter: ['alpha']
    }
  };
  const singleDirect = await buildCompositeContextPackPayload(singleRepoArgs);
  assert.deepEqual(normalizeRiskProjection(singleDirect), {
    selectedRepos: ['alpha'],
    skippedRepos: [],
    flows: [{
      flowId: `sha1:${'a'.repeat(40)}`,
      repoAlias: 'alpha',
      sourceAlias: 'alpha',
      sinkAlias: 'alpha',
      nodeAliases: ['alpha', 'alpha'],
      evidenceAliases: ['alpha']
    }]
  });

  const singleApi = await requestJson('POST', '/analysis/context-pack', singleRepoArgs, serverInfo);
  assert.equal(singleApi.status, 200, 'expected single-repo federated API request to succeed');
  assert.deepEqual(normalizeRiskProjection(singleApi.body?.result), normalizeRiskProjection(singleDirect));

  const singleMcp = await handleToolCall('context_pack', singleRepoArgs);
  assert.deepEqual(normalizeRiskProjection(singleMcp), normalizeRiskProjection(singleDirect));

  const multiRepoArgs = {
    ...baseArgs,
    maxFederatedRepos: 2
  };
  const multiDirect = await buildCompositeContextPackPayload(multiRepoArgs);
  assert.deepEqual(normalizeRiskProjection(multiDirect), {
    selectedRepos: ['alpha', 'beta'],
    skippedRepos: [],
    flows: [
      {
        flowId: `sha1:${'a'.repeat(40)}`,
        repoAlias: 'alpha',
        sourceAlias: 'alpha',
        sinkAlias: 'alpha',
        nodeAliases: ['alpha', 'alpha'],
        evidenceAliases: ['alpha']
      },
      {
        flowId: `sha1:${'b'.repeat(40)}`,
        repoAlias: 'beta',
        sourceAlias: 'beta',
        sinkAlias: 'beta',
        nodeAliases: ['beta', 'beta'],
        evidenceAliases: ['beta']
      }
    ]
  });

  const multiApi = await requestJson('POST', '/analysis/context-pack', multiRepoArgs, serverInfo);
  assert.equal(multiApi.status, 200, 'expected multi-repo federated API request to succeed');
  assert.deepEqual(normalizeRiskProjection(multiApi.body?.result), normalizeRiskProjection(multiDirect));

  const multiMcp = await handleToolCall('context_pack', multiRepoArgs);
  assert.deepEqual(normalizeRiskProjection(multiMcp), normalizeRiskProjection(multiDirect));
} finally {
  await stop();
}

console.log('context pack federated risk parity test passed');
