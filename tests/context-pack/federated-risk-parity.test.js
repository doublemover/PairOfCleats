#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { handleToolCall } from '../../tools/mcp/tools.js';
import { writeFederatedWorkspaceConfig, startFederatedApiServer } from '../helpers/federated-api.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
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

const writeJsonl = async (filePath, rows) => {
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, body ? `${body}\n` : '', 'utf8');
};

const buildWatchStep = (alias) => ({
  taintIn: ['req.body'],
  taintOut: ['input'],
  propagatedArgIndices: [0],
  boundParams: ['input'],
  calleeNormalized: `query_${alias}`,
  sanitizerPolicy: 'terminate',
  sanitizerBarrierApplied: false,
  sanitizerBarriersBefore: 0,
  sanitizerBarriersAfter: 0,
  confidenceBefore: 0.8,
  confidenceAfter: 0.7,
  confidenceDelta: -0.1
});

const buildRiskRepo = async (repoPath, alias, priority) => {
  const sourceText = `export function ${alias}Risk(input) {\n  return query(input);\n}\n`;
  const fileRelPath = `src/${alias}.js`;
  const fileAbsPath = path.join(repoPath, fileRelPath);
  await fs.mkdir(path.dirname(fileAbsPath), { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q'], {
    cwd: repoPath,
    encoding: 'utf8'
  });
  assert.equal(gitInit.status, 0, `expected git init to succeed for ${repoPath}`);
  await fs.writeFile(fileAbsPath, sourceText, 'utf8');
  await fs.writeFile(path.join(repoPath, '.pairofcleats.json'), `${JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2)}\n`, 'utf8');

  const repoCacheRoot = getRepoCacheRoot(repoPath);
  const buildId = `build-${alias}`;
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), `${JSON.stringify({
    buildId,
    buildRoot,
    modes: ['code']
  }, null, 2)}\n`, 'utf8');

  const { indexDir } = await createBaseIndex({
    rootDir: buildRoot,
    chunkMeta: [{
      id: 0,
      file: fileRelPath,
      chunkUid: 'chunk-risk',
      start: 0,
      end: sourceText.length,
      startLine: 1,
      endLine: 2
    }],
    tokenPostings: {
      vocab: ['query', alias],
      postings: [
        [[0, 1]],
        [[0, 1]]
      ],
      docLengths: [2],
      avgDocLen: 2,
      totalDocs: 1
    },
    indexState: {
      generatedAt: '2026-03-19T12:00:00.000Z',
      mode: 'code',
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: 'compat-federated-risk'
    }
  });
  const finalIndexDir = path.join(buildRoot, 'index-code');
  await replaceDir(indexDir, finalIndexDir);
  await fs.rm(path.join(buildRoot, '.index-root'), { recursive: true, force: true });

  const queryExcerpt = 'query(input)';
  const queryOffset = sourceText.indexOf(queryExcerpt);
  const flowId = `sha1:${alias[0].repeat(40)}`;

  await writeJsonObjectFile(path.join(finalIndexDir, 'risk_interprocedural_stats.json'), {
    fields: {
      schemaVersion: 1,
      generatedAt: '2026-03-19T12:00:00.000Z',
      mode: 'code',
      status: 'ok',
      reason: null,
      effectiveConfig: {
        enabled: true,
        summaryOnly: false,
        emitArtifacts: 'jsonl'
      },
      counts: {
        flowsEmitted: 1,
        summariesEmitted: 1,
        uniqueCallSitesReferenced: 1
      },
      callSiteSampling: {
        strategy: 'firstN',
        maxCallSitesPerEdge: 1,
        order: 'deterministic'
      },
      capsHit: [],
      timingMs: {
        summaries: 1,
        propagation: 1,
        io: 1,
        total: 3
      }
    }
  });

  await writeJsonl(path.join(finalIndexDir, 'risk_summaries.jsonl'), [{
    schemaVersion: 1,
    chunkUid: 'chunk-risk',
    file: fileRelPath,
    languageId: 'javascript',
    symbol: {
      name: `${alias}Risk`,
      kind: 'FunctionDeclaration',
      signature: `${alias}Risk(input)`
    },
    signals: {
      sources: [],
      sinks: [],
      sanitizers: [],
      localFlows: []
    },
    totals: {
      sources: 1,
      sinks: 1,
      sanitizers: 0,
      localFlows: 0
    },
    truncated: {
      sources: false,
      sinks: false,
      sanitizers: false,
      localFlows: false,
      evidence: false
    }
  }]);

  await writeJsonl(path.join(finalIndexDir, 'risk_flows.jsonl'), [{
    schemaVersion: 1,
    flowId,
    source: {
      chunkUid: 'chunk-risk',
      ruleId: 'source.req.body',
      ruleName: 'req.body',
      ruleType: 'source',
      category: 'input',
      severity: 'low',
      confidence: 0.7,
      tags: ['input']
    },
    sink: {
      chunkUid: `chunk-sink-${alias}`,
      ruleId: 'sink.sql.query',
      ruleName: 'sql.query',
      ruleType: 'sink',
      category: 'injection',
      severity: 'high',
      confidence: 0.9,
      tags: ['sql']
    },
    path: {
      chunkUids: ['chunk-risk', `chunk-sink-${alias}`],
      callSiteIdsByStep: [[`cs-${alias}`]],
      watchByStep: [buildWatchStep(alias)]
    },
    confidence: priority >= 10 ? 0.95 : 0.85,
    notes: {
      strictness: 'conservative',
      sanitizerPolicy: 'terminate',
      hopCount: 1,
      sanitizerBarriersHit: 0,
      capsHit: []
    }
  }]);

  await writeJsonl(path.join(finalIndexDir, 'call_sites.jsonl'), [{
    callSiteId: `cs-${alias}`,
    callerChunkUid: 'chunk-risk',
    file: fileRelPath,
    languageId: 'javascript',
    start: queryOffset,
    end: queryOffset + queryExcerpt.length,
    startLine: 2,
    startCol: 10,
    endLine: 2,
    endCol: 22,
    calleeRaw: 'query',
    calleeNormalized: 'query',
    args: ['input']
  }]);

  await writeJsonObjectFile(path.join(finalIndexDir, 'pieces', 'manifest.json'), {
    fields: {
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: 'compat-federated-risk',
      generatedAt: '2026-03-19T12:00:00.000Z',
      mode: 'code',
      stage: 'context-pack-federated-risk-test',
      pieces: [
        { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
        { name: 'file_meta', path: 'file_meta.json', format: 'json' },
        { name: 'token_postings', path: 'token_postings.json', format: 'json' },
        { name: 'index_state', path: 'index_state.json', format: 'json' },
        { name: 'filelists', path: '.filelists.json', format: 'json' },
        { name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' },
        { name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' },
        { name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' },
        { name: 'call_sites', path: 'call_sites.jsonl', format: 'jsonl' }
      ]
    }
  });

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
