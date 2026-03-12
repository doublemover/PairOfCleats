#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { renderCompositeContextPack } from '../../src/retrieval/output/composite-context-pack.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-risk-assembly');
const repoRoot = path.join(tempRoot, 'repo');
const repoFile = path.join(repoRoot, 'src', 'file.js');
const fixedNow = () => '2026-03-12T00:00:00.000Z';

const summaryRow = {
  schemaVersion: 1,
  chunkUid: 'chunk-risk',
  file: 'src/file.js',
  languageId: 'javascript',
  symbol: {
    name: 'risky',
    kind: 'FunctionDeclaration',
    signature: 'risky(input)'
  },
  signals: {
    sources: [{
      ruleId: 'source.req.body',
      ruleName: 'req.body',
      ruleType: 'source',
      category: 'input',
      severity: 'low',
      confidence: 0.6,
      tags: ['a', 'b'],
      evidence: []
    }],
    sinks: [{
      ruleId: 'sink.sql.query',
      ruleName: 'sql.query',
      ruleType: 'sink',
      category: 'logging',
      severity: 'high',
      confidence: 0.9,
      tags: ['b'],
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

const flowRow = {
  schemaVersion: 1,
  flowId: 'sha1:1111111111111111111111111111111111111111',
  source: {
    chunkUid: 'chunk-risk',
    ruleId: 'source.req.body',
    ruleName: 'req.body',
    ruleType: 'source',
    category: 'input',
    severity: 'low',
    confidence: 0.6,
    tags: ['input', 'request']
  },
  sink: {
    chunkUid: 'chunk-risk-sink',
    ruleId: 'sink.sql.query',
    ruleName: 'sql.query',
    ruleType: 'sink',
    category: 'injection',
    severity: 'high',
    confidence: 0.9,
    tags: ['sql', 'exec']
  },
  path: {
    chunkUids: ['chunk-risk', 'chunk-risk-sink'],
    callSiteIdsByStep: [['cs-1']]
  },
  confidence: 0.88,
  notes: {
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    hopCount: 1,
    sanitizerBarriersHit: 0,
    capsHit: []
  }
};

const callSiteRow = {
  callSiteId: 'cs-1',
  callerChunkUid: 'chunk-risk',
  file: 'src/file.js',
  languageId: 'javascript',
  start: 0,
  end: 12,
  startLine: 1,
  startCol: 1,
  endLine: 1,
  endCol: 12,
  calleeRaw: 'query',
  calleeNormalized: 'query',
  args: ['input']
};

const rankedPathOnlyFlow = {
  ...flowRow,
  flowId: 'sha1:2222222222222222222222222222222222222222',
  source: {
    ...flowRow.source,
    chunkUid: 'chunk-helper',
    severity: 'medium',
    confidence: 0.95
  },
  sink: {
    ...flowRow.sink,
    chunkUid: 'chunk-helper-sink',
    severity: 'low',
    confidence: 0.95
  },
  path: {
    chunkUids: ['chunk-helper', 'chunk-risk', 'chunk-helper-sink'],
    callSiteIdsByStep: [['cs-1']]
  },
  confidence: 0.95,
  notes: {
    ...flowRow.notes,
    hopCount: 3
  }
};

const truncatedEvidenceFlow = {
  ...flowRow,
  flowId: 'sha1:3333333333333333333333333333333333333333',
  path: {
    chunkUids: ['chunk-risk', 'chunk-mid-1', 'chunk-mid-2', 'chunk-mid-3', 'chunk-mid-4', 'chunk-mid-5', 'chunk-mid-6', 'chunk-mid-7', 'chunk-risk-sink'],
    callSiteIdsByStep: [
      ['cs-1', 'cs-2', 'cs-3', 'cs-4'],
      ['cs-5'],
      ['cs-6'],
      ['cs-7'],
      ['cs-8'],
      ['cs-9'],
      ['cs-10'],
      ['cs-11'],
      ['cs-12']
    ]
  },
  confidence: 0.87,
  notes: {
    ...flowRow.notes,
    hopCount: 9
  }
};

const oversizedBudgetFlow = {
  ...flowRow,
  flowId: 'sha1:4444444444444444444444444444444444444444',
  source: {
    ...flowRow.source,
    ruleName: 'x'.repeat(30000)
  },
  confidence: 0.99,
  notes: {
    ...flowRow.notes,
    hopCount: 1
  }
};

const extraCallSiteRows = Array.from({ length: 12 }, (_, index) => ({
  ...callSiteRow,
  callSiteId: `cs-${index + 1}`,
  startLine: index + 1,
  endLine: index + 1,
  calleeRaw: `callee-${index + 1}`,
  calleeNormalized: `callee-${index + 1}`,
  args: [`arg-${index + 1}`]
}));

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
    flowsEmitted: 1,
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
    propagation: 2,
    io: 1,
    total: 4
  }
};

const chunkMeta = [
  {
    id: 0,
    file: 'src/file.js',
    chunkUid: 'chunk-risk',
    start: 0,
    end: 48,
    startLine: 1,
    endLine: 3
  }
];

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.writeFile(repoFile, 'export function risky(input) {\n  return query(input);\n}\n', 'utf8');

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
      stage: 'context-pack-risk',
      pieces
    }
  });
};

const buildPack = async ({ name, stats = null, summaries = null, flows = null, callSites = null }) => {
  const indexDir = path.join(tempRoot, name, 'index-code');
  await fs.rm(indexDir, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });
  const pieces = [];
  if (stats) {
    await writeJsonObjectFile(path.join(indexDir, 'risk_interprocedural_stats.json'), { fields: stats });
    pieces.push({ name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' });
  }
  if (summaries) {
    await writeJsonl(path.join(indexDir, 'risk_summaries.jsonl'), summaries);
    pieces.push({ name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' });
  }
  if (flows) {
    await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), flows);
    pieces.push({ name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' });
  }
  if (callSites) {
    await writeJsonl(path.join(indexDir, 'call_sites.jsonl'), callSites);
    pieces.push({ name: 'call_sites', path: 'call_sites.jsonl', format: 'jsonl' });
  }
  await writeManifest(indexDir, pieces);
  return assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'chunk-risk' },
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
};

const fullPack = await buildPack({
  name: 'full',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [callSiteRow]
});
assert.equal(fullPack.risk?.status, 'ok');
assert.equal(fullPack.risk?.version, 1);
assert.equal(fullPack.risk?.summary?.chunkUid, 'chunk-risk');
assert.deepEqual(
  fullPack.risk?.analysisStatus?.artifactStatus,
  {
    stats: 'present',
    summaries: 'present',
    flows: 'present',
    callSites: 'present'
  }
);
assert.equal(fullPack.risk?.provenance?.compatibilityKey, 'compat-test');
assert.equal(fullPack.risk?.caps?.maxFlows, 5);
assert.equal(fullPack.risk?.caps?.maxCallSitesPerStep, 3);
assert.equal(fullPack.risk?.flows?.length, 1);
assert.equal(fullPack.risk?.flows?.[0]?.source?.ruleId, 'source.req.body');
assert.equal(fullPack.risk?.flows?.[0]?.sink?.ruleId, 'sink.sql.query');
assert.equal(fullPack.risk?.flows?.[0]?.notes?.hopCount, 1);
assert.equal(fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.callSiteId, 'cs-1');
assert.deepEqual(
  fullPack.risk?.summary?.topCategories,
  [
    { category: 'input', count: 1 },
    { category: 'logging', count: 1 }
  ]
);
assert.deepEqual(
  fullPack.risk?.summary?.topTags,
  [
    { tag: 'b', count: 2 },
    { tag: 'a', count: 1 }
  ]
);
assert.deepEqual(fullPack.risk?.summary?.previewFlowIds, ['sha1:1111111111111111111111111111111111111111']);
assert.equal(validateCompositeContextPack(fullPack).ok, true, 'expected full risk slice to validate');
const fullRendered = renderCompositeContextPack(fullPack);
assert.ok(fullRendered.includes('status: ok'), 'expected rendered status');
assert.ok(fullRendered.includes('cs-1'), 'expected rendered risk evidence');
assert.ok(fullRendered.includes('top categories:'), 'expected rendered top categories');
assert.ok(fullRendered.includes('rules: source.req.body -> sink.sql.query'), 'expected rendered rules');

const summaryOnlyPack = await buildPack({
  name: 'summary-only',
  stats: {
    ...baseStats,
    effectiveConfig: { ...baseStats.effectiveConfig, summaryOnly: true },
    counts: { flowsEmitted: 0, uniqueCallSitesReferenced: 0 }
  },
  summaries: [summaryRow]
});
assert.equal(summaryOnlyPack.risk?.status, 'summary_only');
assert.equal(summaryOnlyPack.risk?.flows?.length, 0);
assert.equal(summaryOnlyPack.risk?.degraded, false);
assert.equal(summaryOnlyPack.risk?.analysisStatus?.summaryOnly, true);

const missingPack = await buildPack({
  name: 'missing'
});
assert.equal(missingPack.risk?.status, 'missing');
assert.deepEqual(
  missingPack.risk?.analysisStatus?.artifactStatus,
  {
    stats: 'missing',
    summaries: 'missing',
    flows: 'not_required',
    callSites: 'not_required'
  }
);
assert.ok(missingPack.warnings?.some((entry) => entry?.code === 'MISSING_RISK'), 'expected missing risk warning');

const degradedPack = await buildPack({
  name: 'degraded',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow]
});
assert.equal(degradedPack.risk?.status, 'degraded');
assert.equal(degradedPack.risk?.degraded, true);
assert.equal(degradedPack.risk?.analysisStatus?.artifactStatus?.callSites, 'missing');
assert.ok(degradedPack.warnings?.some((entry) => entry?.code === 'RISK_CALL_SITES_MISSING'), 'expected degraded call-site warning');

const cappedPack = await buildPack({
  name: 'capped',
  stats: {
    ...baseStats,
    counts: {
      ...baseStats.counts,
      flowsEmitted: 4,
      uniqueCallSitesReferenced: 12
    }
  },
  summaries: [summaryRow],
  flows: [oversizedBudgetFlow, flowRow, rankedPathOnlyFlow, truncatedEvidenceFlow],
  callSites: extraCallSiteRows
});
assert.equal(cappedPack.risk?.status, 'ok');
assert.deepEqual(
  cappedPack.risk?.flows?.map((flow) => flow.flowId),
  [
    'sha1:1111111111111111111111111111111111111111',
    'sha1:3333333333333333333333333333333333333333',
    'sha1:2222222222222222222222222222222222222222'
  ],
  'expected deterministic ranking and byte-budget omission'
);
assert.equal(cappedPack.risk?.flows?.[0]?.rank, 2, 'expected selected flow to retain its original rank');
assert.equal(cappedPack.risk?.flows?.[2]?.score?.seedRelevance, 1, 'expected path-only flow to rank below direct source flow');
assert.equal(cappedPack.risk?.flows?.[1]?.path?.truncatedSteps, 1, 'expected step cap truncation');
assert.equal(cappedPack.risk?.flows?.[1]?.evidence?.callSitesByStep?.[0]?.length, 3, 'expected call-site cap truncation');
assert.ok(Array.isArray(cappedPack.risk?.caps?.hits) && cappedPack.risk.caps.hits.includes('maxRiskBytes'), 'expected byte-budget cap hit');
assert.ok(cappedPack.risk.caps.hits.includes('maxStepsPerFlow'), 'expected step cap hit');
assert.ok(cappedPack.risk.caps.hits.includes('maxCallSitesPerStep'), 'expected call-site cap hit');
assert.ok(cappedPack.risk.truncation.some((entry) => entry.cap === 'maxRiskBytes'), 'expected byte truncation record');
assert.ok(cappedPack.risk.truncation.some((entry) => entry.cap === 'maxStepsPerFlow'), 'expected step truncation record');
assert.ok(cappedPack.risk.truncation.some((entry) => entry.cap === 'maxCallSitesPerStep'), 'expected call-site truncation record');
assert.equal(validateCompositeContextPack(cappedPack).ok, true, 'expected capped risk slice to validate');

console.log('context pack risk assembly test passed');
