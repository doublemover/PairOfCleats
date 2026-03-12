#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-risk-ranking-budget');
const repoRoot = path.join(tempRoot, 'repo');
const repoFile = path.join(repoRoot, 'src', 'risk.js');
const fixedNow = () => '2026-03-12T00:00:00.000Z';

const summaryRow = {
  schemaVersion: 1,
  chunkUid: 'chunk-primary',
  file: 'src/risk.js',
  languageId: 'javascript',
  symbol: {
    name: 'risky',
    kind: 'FunctionDeclaration',
    signature: 'risky(input)'
  },
  signals: {
    sources: [{
      ruleId: 'source.input',
      ruleName: 'input',
      ruleType: 'source',
      category: 'input',
      severity: 'low',
      confidence: 0.5,
      tags: ['input'],
      evidence: []
    }],
    sinks: [{
      ruleId: 'sink.exec',
      ruleName: 'exec',
      ruleType: 'sink',
      category: 'exec',
      severity: 'high',
      confidence: 0.9,
      tags: ['exec'],
      evidence: []
    }],
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
};

const baseStats = {
  schemaVersion: 1,
  generatedAt: '2026-03-12T00:00:00.000Z',
  mode: 'code',
  status: 'ok',
  reason: null,
  effectiveConfig: {
    enabled: true,
    summaryOnly: false,
    emitArtifacts: 'jsonl'
  },
  counts: {
    flowsEmitted: 7,
    summariesEmitted: 1,
    uniqueCallSitesReferenced: 6
  },
  callSiteSampling: {
    strategy: 'firstN',
    maxCallSitesPerEdge: 3,
    order: 'deterministic'
  },
  capsHit: [],
  timingMs: {
    summaries: 1,
    propagation: 2,
    io: 1,
    total: 4
  }
};

const chunkMeta = [{
  id: 0,
  file: 'src/risk.js',
  chunkUid: 'chunk-primary',
  start: 0,
  end: 64,
  startLine: 1,
  endLine: 4
}];

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.writeFile(repoFile, 'export function risky(input) { return input; }\n', 'utf8');

const writeJsonl = async (filePath, rows) => {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
};

const writeManifest = async (indexDir, pieces) => {
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
    fields: {
      version: 2,
      artifactSurfaceVersion: 'test',
      compatibilityKey: 'compat-test',
      generatedAt: fixedNow(),
      mode: 'code',
      stage: 'context-pack-risk-ranking',
      pieces
    }
  });
};

const makeFlow = ({
  id,
  sourceUid = 'chunk-primary',
  sinkUid = `chunk-sink-${id}`,
  sourceCategory = 'input',
  sinkCategory = 'exec',
  severity = 'medium',
  confidence = 0.5,
  hopCount = 1,
  pathIds = ['chunk-primary', `chunk-sink-${id}`],
  callSiteIdsByStep = [['cs-1']],
  sinkRuleName = `sink-${id}`
}) => ({
  schemaVersion: 1,
  flowId: `sha1:${String(id).padStart(40, '0')}`,
  source: {
    chunkUid: sourceUid,
    ruleId: `source.${id}`,
    ruleName: `source-${id}`,
    ruleType: 'source',
    category: sourceCategory,
    severity: 'low',
    confidence: 0.6
  },
  sink: {
    chunkUid: sinkUid,
    ruleId: `sink.${id}`,
    ruleName: sinkRuleName,
    ruleType: 'sink',
    category: sinkCategory,
    severity,
    confidence: 0.9
  },
  path: {
    chunkUids: pathIds,
    callSiteIdsByStep
  },
  confidence,
  notes: {
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    hopCount,
    sanitizerBarriersHit: 0,
    capsHit: []
  }
});

const callSiteRows = Array.from({ length: 6 }, (_, index) => ({
  callSiteId: `cs-${index + 1}`,
  callerChunkUid: 'chunk-primary',
  file: 'src/risk.js',
  languageId: 'javascript',
  start: index,
  end: index + 1,
  startLine: index + 1,
  startCol: 1,
  endLine: index + 1,
  endCol: 4,
  calleeRaw: `callee${index + 1}`,
  calleeNormalized: `callee${index + 1}`,
  args: ['value']
}));

const hugeName = Array.from({ length: 24000 }, (_, i) => `token${i}`).join(' ');
const flows = [
  makeFlow({ id: 1, severity: 'high', confidence: 0.7, hopCount: 2 }),
  makeFlow({ id: 2, sourceUid: 'chunk-other', sinkUid: 'chunk-other-2', severity: 'critical', confidence: 0.99, hopCount: 1, pathIds: ['chunk-other', 'chunk-primary', 'chunk-other-2'] }),
  makeFlow({ id: 3, severity: 'medium', confidence: 0.9, hopCount: 1, callSiteIdsByStep: Array.from({ length: 10 }, () => ['cs-1', 'cs-2', 'cs-3', 'cs-4']) }),
  makeFlow({ id: 4, severity: 'low', confidence: 0.8, hopCount: 1 }),
  makeFlow({ id: 5, severity: 'low', confidence: 0.6, hopCount: 1 }),
  makeFlow({ id: 6, severity: 'low', confidence: 0.5, hopCount: 1 }),
  makeFlow({ id: 7, severity: 'critical', confidence: 0.98, hopCount: 1, sinkRuleName: hugeName })
];

const indexDir = path.join(tempRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await writeJsonObjectFile(path.join(indexDir, 'risk_interprocedural_stats.json'), { fields: baseStats });
await writeJsonl(path.join(indexDir, 'risk_summaries.jsonl'), [summaryRow]);
await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), flows);
await writeJsonl(path.join(indexDir, 'call_sites.jsonl'), callSiteRows);
await writeManifest(indexDir, [
  { name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' },
  { name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' },
  { name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' },
  { name: 'call_sites', path: 'call_sites.jsonl', format: 'jsonl' }
]);

const pack = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-primary' },
  chunkMeta,
  repoRoot,
  indexDir,
  indexCompatKey: 'compat-test',
  now: fixedNow,
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false
});

assert.equal(pack.risk?.flows?.length, 5, 'expected maxFlows cap');
assert.equal(pack.risk?.flows?.[0]?.flowId, flows[0].flowId, 'direct source/sink match should outrank indirect in-path match');
assert.equal(pack.risk?.flows?.[1]?.flowId, flows[2].flowId, 'higher confidence direct flow should sort second');
assert.equal(pack.risk?.flows?.some((flow) => flow.flowId === flows[6].flowId), false, 'expected oversized flow to be omitted by total budget');
assert.ok(pack.risk?.caps?.hits?.includes('maxFlows'), 'expected maxFlows cap hit');
assert.ok(pack.risk?.caps?.hits?.includes('maxStepsPerFlow'), 'expected maxStepsPerFlow cap hit');
assert.ok(pack.risk?.caps?.hits?.includes('maxCallSitesPerStep'), 'expected maxCallSitesPerStep cap hit');
assert.ok(
  pack.risk?.caps?.hits?.includes('maxRiskBytes') || pack.risk?.caps?.hits?.includes('maxRiskTokens'),
  'expected total risk budget cap hit'
);
assert.ok(pack.risk?.truncation?.some((entry) => entry?.cap === 'maxFlows'), 'expected maxFlows truncation record');
assert.ok(pack.risk?.truncation?.some((entry) => entry?.cap === 'maxStepsPerFlow'), 'expected maxStepsPerFlow truncation record');
assert.ok(pack.risk?.truncation?.some((entry) => entry?.cap === 'maxCallSitesPerStep'), 'expected maxCallSitesPerStep truncation record');
assert.ok(
  pack.risk?.truncation?.some((entry) => entry?.cap === 'maxRiskBytes' || entry?.cap === 'maxRiskTokens'),
  'expected total budget truncation record'
);
assert.equal(pack.risk?.summary?.previewFlowIds?.[0], flows[0].flowId, 'expected previewFlowIds to follow ranked order');
assert.equal(pack.risk?.flows?.[1]?.path?.truncatedSteps > 0, true, 'expected path steps to truncate');
assert.equal(pack.risk?.flows?.[1]?.path?.callSiteIdsByStep?.[0]?.length, 3, 'expected call-site evidence per step to truncate');
assert.equal(pack.risk?.flows?.[0]?.rank, 2, 'expected emitted flow to retain original rank after higher-ranked omission');
assert.equal(pack.risk?.flows?.[0]?.score?.seedRelevance, 3, 'expected direct flow seed relevance score');

console.log('context pack risk ranking and budget test passed');
