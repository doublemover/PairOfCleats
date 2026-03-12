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
    confidence: 0.6
  },
  sink: {
    chunkUid: 'chunk-risk-sink',
    ruleId: 'sink.sql.query',
    ruleName: 'sql.query',
    ruleType: 'sink',
    category: 'injection',
    severity: 'high',
    confidence: 0.9
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
assert.equal(fullPack.risk?.summary?.chunkUid, 'chunk-risk');
assert.equal(fullPack.risk?.flows?.length, 1);
assert.equal(fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.callSiteId, 'cs-1');
assert.equal(validateCompositeContextPack(fullPack).ok, true, 'expected full risk slice to validate');
const fullRendered = renderCompositeContextPack(fullPack);
assert.ok(fullRendered.includes('status: ok'), 'expected rendered status');
assert.ok(fullRendered.includes('cs-1'), 'expected rendered risk evidence');

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

const missingPack = await buildPack({
  name: 'missing'
});
assert.equal(missingPack.risk?.status, 'missing');
assert.ok(missingPack.warnings?.some((entry) => entry?.code === 'MISSING_RISK'), 'expected missing risk warning');

const degradedPack = await buildPack({
  name: 'degraded',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow]
});
assert.equal(degradedPack.risk?.status, 'degraded');
assert.equal(degradedPack.risk?.degraded, true);
assert.ok(degradedPack.warnings?.some((entry) => entry?.code === 'RISK_CALL_SITES_MISSING'), 'expected degraded call-site warning');

console.log('context pack risk assembly test passed');
