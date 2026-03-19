#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { buildRiskDeltaPayload } from '../../src/context-pack/risk-delta.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { createAnalysisSurfaceHarness } from '../helpers/analysis-surface-parity.js';
import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'risk-delta-surface-parity');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = {
  cache: { root: cacheRoot },
  sqlite: { use: false },
  lmdb: { use: false }
};
const env = applyTestEnv({ cacheRoot });

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sha1Value = (value) => crypto.createHash('sha1').update(String(value)).digest('hex');

const sha1File = async (filePath) => {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(content).digest('hex');
};

const writePiecesManifest = async (indexDir, files) => {
  const pieces = [];
  for (const entry of files) {
    const absolute = path.join(indexDir, entry.path);
    const stat = await fs.stat(absolute);
    pieces.push({
      type: entry.type,
      name: entry.name,
      format: 'json',
      path: entry.path,
      bytes: Number(stat.size || 0),
      checksum: `sha1:${await sha1File(absolute)}`
    });
  }
  await writeJson(path.join(indexDir, 'pieces', 'manifest.json'), {
    version: 2,
    artifactSurfaceVersion: '0.2.0',
    pieces
  });
};

const buildFlow = ({
  flowId,
  confidence,
  chunkUid,
  sinkChunkUid = chunkUid,
  sinkRuleId,
  pathChunkUids,
  callSiteId,
  semanticKinds
}) => ({
  flowId,
  confidence,
  source: {
    chunkUid,
    ruleId: 'source.req.body',
    ruleName: 'req.body',
    ruleType: 'source',
    ruleRole: 'source',
    category: 'input',
    severity: 'medium',
    tags: ['http']
  },
  sink: {
    chunkUid: sinkChunkUid,
    ruleId: sinkRuleId,
    ruleName: sinkRuleId,
    ruleType: 'sink',
    ruleRole: 'sink',
    category: 'execution',
    severity: 'critical',
    tags: ['exec']
  },
  path: {
    chunkUids: pathChunkUids,
    callSiteIdsByStep: [[callSiteId]],
    watchByStep: [{
      semanticKinds,
      confidenceBefore: confidence,
      confidenceAfter: Math.max(0, confidence - 0.1)
    }]
  },
  notes: {
    hopCount: Math.max(0, pathChunkUids.length - 1),
    strictness: 'conservative'
  }
});

const buildPartialFlow = ({
  partialFlowId,
  confidence,
  chunkUid,
  frontierChunkUid,
  terminalReason
}) => ({
  partialFlowId,
  confidence,
  source: {
    chunkUid,
    ruleId: 'source.req.body',
    ruleName: 'req.body',
    ruleType: 'source',
    ruleRole: 'source',
    category: 'input',
    severity: 'medium',
    tags: ['http']
  },
  frontier: {
    chunkUid: frontierChunkUid,
    terminalReason,
    blockedExpansions: []
  },
  path: {
    chunkUids: [chunkUid, frontierChunkUid],
    callSiteIdsByStep: [['call-frontier']],
    watchByStep: [{
      semanticKinds: ['callback'],
      confidenceBefore: confidence,
      confidenceAfter: Math.max(0, confidence - 0.05)
    }]
  },
  notes: {
    terminalReason,
    hopCount: 1
  }
});

const seedBuild = async ({
  repoCacheRoot,
  buildId,
  chunkUid,
  flows,
  partialFlows
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });

  const fileMeta = [{
    id: 1,
    file: 'src/a.js',
    hash: sha1Value(buildId),
    size: 32,
    ext: '.js'
  }];
  const chunkMeta = [{
    id: 1,
    fileId: 1,
    file: 'src/a.js',
    start: 0,
    end: 32,
    startLine: 1,
    endLine: 2,
    kind: 'function',
    name: 'alpha',
    chunkUid,
    metaV2: {
      chunkUid,
      chunkId: 'alpha',
      file: 'src/a.js',
      virtualPath: 'src/a.js',
      symbol: {
        symbolId: 'sym:alpha',
        name: 'alpha',
        kind: 'function'
      }
    }
  }];
  const riskSummary = [{
    chunkUid,
    file: 'src/a.js',
    languageId: 'javascript',
    totals: {
      sources: 1,
      sinks: flows.length,
      sanitizers: 0,
      localFlows: 0
    },
    truncated: {
      sources: false,
      sinks: false,
      sanitizers: false,
      localFlows: false,
      evidence: false
    },
    signals: {
      sources: [{ category: 'input', tags: ['http'] }],
      sinks: flows.map((flow) => ({ category: flow.sink.category, tags: flow.sink.tags })),
      sanitizers: [],
      localFlows: []
    }
  }];
  const riskStats = {
    status: 'ok',
    counts: {
      flowsEmitted: flows.length,
      partialFlowsEmitted: partialFlows.length,
      summariesEmitted: 1,
      uniqueCallSitesReferenced: flows.length + partialFlows.length
    },
    effectiveConfig: {
      enabled: true,
      summaryOnly: false
    },
    provenance: {
      ruleBundle: {
        version: '1.0.0',
        fingerprint: `sha1:${sha1Value(`rules-${buildId}`)}`
      }
    },
    artifacts: {
      stats: 'present',
      summaries: 'present',
      flows: 'present',
      partialFlows: 'present',
      callSites: 'not_required'
    }
  };

  await writeJson(path.join(indexDir, 'file_meta.json'), fileMeta);
  await writeJson(path.join(indexDir, 'chunk_meta.json'), chunkMeta);
  await writeJson(path.join(indexDir, 'risk_summaries.json'), riskSummary);
  await writeJson(path.join(indexDir, 'risk_flows.json'), flows);
  await writeJson(path.join(indexDir, 'risk_partial_flows.json'), partialFlows);
  await writeJson(path.join(indexDir, 'risk_interprocedural_stats.json'), riskStats);
  await writePiecesManifest(indexDir, [
    { type: 'meta', name: 'file_meta', path: 'file_meta.json' },
    { type: 'chunks', name: 'chunk_meta', path: 'chunk_meta.json' },
    { type: 'analysis', name: 'risk_summaries', path: 'risk_summaries.json' },
    { type: 'analysis', name: 'risk_flows', path: 'risk_flows.json' },
    { type: 'analysis', name: 'risk_partial_flows', path: 'risk_partial_flows.json' },
    { type: 'analysis', name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json' }
  ]);
  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash: 'cfg-risk-delta',
    tool: { version: '1.0.0' },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
  });
};

const normalizeDelta = (payload) => ({
  from: payload?.from?.canonical || null,
  to: payload?.to?.canonical || null,
  fromSeedStatus: payload?.from?.seedStatus || null,
  toSeedStatus: payload?.to?.seedStatus || null,
  fromTarget: payload?.from?.target?.chunkUid || null,
  toTarget: payload?.to?.target?.chunkUid || null,
  fromRuleBundle: payload?.from?.provenance?.ruleBundle?.fingerprint || null,
  toRuleBundle: payload?.to?.provenance?.ruleBundle?.fingerprint || null,
  flowSummary: payload?.summary?.flowCounts || null,
  partialSummary: payload?.summary?.partialFlowCounts || null,
  added: Array.isArray(payload?.deltas?.flows?.added) ? payload.deltas.flows.added.map((entry) => entry.flowId) : [],
  removed: Array.isArray(payload?.deltas?.flows?.removed) ? payload.deltas.flows.removed.map((entry) => entry.flowId) : [],
  changed: Array.isArray(payload?.deltas?.flows?.changed)
    ? payload.deltas.flows.changed.map((entry) => ({
      flowId: entry.flowId,
      changedFields: entry.changedFields
    }))
    : [],
  addedPartial: Array.isArray(payload?.deltas?.partialFlows?.added)
    ? payload.deltas.partialFlows.added.map((entry) => entry.partialFlowId)
    : [],
  removedPartial: Array.isArray(payload?.deltas?.partialFlows?.removed)
    ? payload.deltas.partialFlows.removed.map((entry) => entry.partialFlowId)
    : [],
  changedPartial: Array.isArray(payload?.deltas?.partialFlows?.changed)
    ? payload.deltas.partialFlows.changed.map((entry) => ({
      partialFlowId: entry.partialFlowId,
      changedFields: entry.changedFields
    }))
    : []
});

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoRoot, 'src', 'a.js'), 'export function alpha(input) { return input; }\n', 'utf8').catch(async () => {
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'a.js'), 'export function alpha(input) { return input; }\n', 'utf8');
});

const flowStableA = buildFlow({
  flowId: 'sha1:1111111111111111111111111111111111111111',
  confidence: 0.9,
  chunkUid: 'chunk-alpha-a',
  sinkRuleId: 'sink.eval',
  pathChunkUids: ['chunk-alpha-a'],
  callSiteId: 'call-a',
  semanticKinds: ['callback']
});
const flowRemoved = buildFlow({
  flowId: 'sha1:2222222222222222222222222222222222222222',
  confidence: 0.7,
  chunkUid: 'chunk-alpha-a',
  sinkRuleId: 'sink.shell',
  pathChunkUids: ['chunk-alpha-a'],
  callSiteId: 'call-b',
  semanticKinds: ['builder']
});
const partialStableA = buildPartialFlow({
  partialFlowId: 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  confidence: 0.6,
  chunkUid: 'chunk-alpha-a',
  frontierChunkUid: 'chunk-frontier-a',
  terminalReason: 'maxDepth'
});

await seedBuild({
  repoCacheRoot,
  buildId: 'build-a',
  chunkUid: 'chunk-alpha-a',
  flows: [flowStableA, flowRemoved],
  partialFlows: [partialStableA]
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-a',
  buildRoot: 'builds/build-a',
  buildRoots: { code: 'builds/build-a' }
});
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: 'snap-20260319000000-riska'
});

const flowStableB = buildFlow({
  flowId: 'sha1:1111111111111111111111111111111111111111',
  confidence: 0.5,
  chunkUid: 'chunk-alpha-b',
  sinkRuleId: 'sink.eval',
  pathChunkUids: ['chunk-alpha-b', 'chunk-helper-b'],
  callSiteId: 'call-a2',
  semanticKinds: ['callback', 'wrapper']
});
const flowAdded = buildFlow({
  flowId: 'sha1:3333333333333333333333333333333333333333',
  confidence: 0.8,
  chunkUid: 'chunk-alpha-b',
  sinkRuleId: 'sink.exec',
  pathChunkUids: ['chunk-alpha-b'],
  callSiteId: 'call-c',
  semanticKinds: ['asyncHandoff']
});
const partialStableB = buildPartialFlow({
  partialFlowId: 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  confidence: 0.75,
  chunkUid: 'chunk-alpha-b',
  frontierChunkUid: 'chunk-frontier-b',
  terminalReason: 'fanout'
});
const partialAdded = buildPartialFlow({
  partialFlowId: 'sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  confidence: 0.5,
  chunkUid: 'chunk-alpha-b',
  frontierChunkUid: 'chunk-frontier-c',
  terminalReason: 'budget'
});

await seedBuild({
  repoCacheRoot,
  buildId: 'build-b',
  chunkUid: 'chunk-alpha-b',
  flows: [flowStableB, flowAdded],
  partialFlows: [partialStableB, partialAdded]
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-b',
  buildRoot: 'builds/build-b',
  buildRoots: { code: 'builds/build-b' }
});
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: 'snap-20260319000000-riskb'
});

await withTemporaryEnv(env, async () => {
  const buildPayload = await buildRiskDeltaPayload({
    repoRoot,
    userConfig,
    from: 'build:build-a',
    to: 'build:build-b',
    seed: 'file:src/a.js',
    includePartialFlows: true
  });
  const snapshotPayload = await buildRiskDeltaPayload({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260319000000-riska',
    to: 'snap:snap-20260319000000-riskb',
    seed: 'file:src/a.js',
    includePartialFlows: true
  });

  const normalizedBuild = normalizeDelta(buildPayload);
  const normalizedSnapshot = normalizeDelta(snapshotPayload);
  assert.deepEqual(
    { ...normalizedBuild, from: 'snap:snap-20260319000000-riska', to: 'snap:snap-20260319000000-riskb' },
    normalizedSnapshot,
    'expected snapshot and build ref deltas to match after ref normalization'
  );
  assert.deepEqual(normalizedSnapshot.added, ['sha1:3333333333333333333333333333333333333333']);
  assert.deepEqual(normalizedSnapshot.removed, ['sha1:2222222222222222222222222222222222222222']);
  assert.deepEqual(normalizedSnapshot.addedPartial, ['sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
  assert.equal(normalizedSnapshot.changed[0]?.flowId, 'sha1:1111111111111111111111111111111111111111');
  assert.ok(normalizedSnapshot.changed[0]?.changedFields.includes('confidence'), 'expected changed flow to record confidence diff');
  assert.equal(normalizedSnapshot.changedPartial[0]?.partialFlowId, 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  const harness = await createAnalysisSurfaceHarness({ fixtureRoot: repoRoot, env: process.env });
  try {
    const cliRun = harness.runCli([
      'risk',
      'delta',
      '--json',
      '--repo', repoRoot,
      '--from', 'snap:snap-20260319000000-riska',
      '--to', 'snap:snap-20260319000000-riskb',
      '--seed', 'file:src/a.js',
      '--include-partial-flows'
    ]);
    assert.equal(cliRun.status, 0, `expected CLI risk delta call to succeed: ${cliRun.stderr}`);

    const apiRun = await harness.runApi('/analysis/risk-delta', {
      repoPath: repoRoot,
      from: 'snap:snap-20260319000000-riska',
      to: 'snap:snap-20260319000000-riskb',
      seed: 'file:src/a.js',
      includePartialFlows: true
    });
    assert.equal(apiRun.status, 200, 'expected API risk delta call to succeed');

    const mcpRun = await harness.runMcp('risk_delta', {
      repoPath: repoRoot,
      from: 'snap:snap-20260319000000-riska',
      to: 'snap:snap-20260319000000-riskb',
      seed: 'file:src/a.js',
      includePartialFlows: true
    });
    assert.equal(mcpRun.ok, true, 'expected MCP risk delta call to succeed');

    const expected = normalizeDelta(cliRun.parsed);
    assert.deepEqual(normalizeDelta(apiRun.parsed?.result), expected, 'expected API risk delta output to match CLI');
    assert.deepEqual(normalizeDelta(mcpRun.result), expected, 'expected MCP risk delta output to match CLI');
  } finally {
    await harness.close();
  }
});

console.log('risk delta surface parity test passed');
