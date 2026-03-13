#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { assembleCompositeContextPack, classifyRiskLoadFailure } from '../../src/context-pack/assemble.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-risk-strict-status');
const repoRoot = path.join(tempRoot, 'repo');
const repoFile = path.join(repoRoot, 'src', 'risk.js');
const fixedNow = () => '2026-03-12T00:00:00.000Z';

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.writeFile(repoFile, 'export function risky(input) { return input; }\n', 'utf8');

const chunkMeta = [{ id: 0, file: 'src/risk.js', chunkUid: 'chunk-primary', start: 0, end: 48, startLine: 1, endLine: 1 }];

const baseStats = {
  schemaVersion: 1,
  generatedAt: fixedNow(),
  mode: 'code',
  status: 'ok',
  reason: null,
  effectiveConfig: { enabled: true, summaryOnly: false, emitArtifacts: 'jsonl' },
  counts: { flowsEmitted: 1, summariesEmitted: 1, uniqueCallSitesReferenced: 0 },
  callSiteSampling: { strategy: 'firstN', maxCallSitesPerEdge: 0, order: 'deterministic' },
  capsHit: [],
  timingMs: { summaries: 1, propagation: 1, io: 1, total: 3 }
};

const summaryRow = {
  schemaVersion: 1,
  chunkUid: 'chunk-primary',
  file: 'src/risk.js',
  languageId: 'javascript',
  symbol: { name: 'risky', kind: 'FunctionDeclaration', signature: 'risky(input)' },
  signals: { sources: [], sinks: [], sanitizers: [], localFlows: [] },
  totals: { sources: 0, sinks: 1, sanitizers: 0, localFlows: 0 },
  truncated: { sources: false, sinks: false, sanitizers: false, localFlows: false, evidence: false }
};

const normalFlow = {
  schemaVersion: 1,
  flowId: 'sha1:1111111111111111111111111111111111111111',
  source: { chunkUid: 'chunk-primary', ruleId: 'source.input', ruleName: 'input', ruleType: 'source', category: 'input', severity: 'low', confidence: 0.5 },
  sink: { chunkUid: 'chunk-sink', ruleId: 'sink.exec', ruleName: 'exec', ruleType: 'sink', category: 'exec', severity: 'high', confidence: 0.9 },
  path: { chunkUids: ['chunk-primary', 'chunk-sink'], callSiteIdsByStep: [[]] },
  confidence: 0.9,
  notes: { strictness: 'conservative', sanitizerPolicy: 'terminate', hopCount: 1, sanitizerBarriersHit: 0, capsHit: [] }
};

const hugeFlow = {
  ...normalFlow,
  flowId: 'sha1:2222222222222222222222222222222222222222',
  sink: { ...normalFlow.sink, ruleName: 'x'.repeat(30000) },
  confidence: 0.99
};

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
      compatibilityKey: 'compat-strict',
      generatedAt: fixedNow(),
      mode: 'code',
      stage: 'context-pack-risk-strict',
      pieces
    }
  });
};

const buildPack = async ({ name, stats = null, summaries = null, flows = null, invalidFlows = false, riskStrict = false }) => {
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
    if (invalidFlows) {
      await fs.writeFile(path.join(indexDir, 'risk_flows.jsonl'), '{not-json}\n', 'utf8');
    } else {
      await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), flows);
    }
    pieces.push({ name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' });
  }
  await writeManifest(indexDir, pieces);
  return assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'chunk-primary' },
    chunkMeta,
    repoRoot,
    indexDir,
    includeGraph: false,
    includeTypes: false,
    includeRisk: true,
    riskStrict,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false,
    now: fixedNow,
    indexCompatKey: 'compat-strict'
  });
};

const assertStrictFail = (indexDir) => {
  assert.throws(
    () => assembleCompositeContextPack({
      seed: { type: 'chunk', chunkUid: 'chunk-primary' },
      chunkMeta,
      repoRoot,
      indexDir,
      includeGraph: false,
      includeTypes: false,
      includeRisk: true,
      riskStrict: true,
      includeImports: false,
      includeUsages: false,
      includeCallersCallees: false,
      now: fixedNow,
      indexCompatKey: 'compat-strict'
    }),
    (err) => err?.code === 'ERR_CONTEXT_PACK_RISK_STRICT'
  );
};

assert.equal(classifyRiskLoadFailure({ code: 'ETIMEDOUT' }), 'timed_out');

const disabledPack = await buildPack({
  name: 'disabled',
  stats: { ...baseStats, status: 'disabled', reason: 'risk-disabled' },
  summaries: [summaryRow]
});
assert.equal(disabledPack.risk?.analysisStatus?.code, 'disabled');
assertStrictFail(path.join(tempRoot, 'disabled', 'index-code'));

const summaryOnlyPack = await buildPack({
  name: 'summary-only',
  stats: { ...baseStats, effectiveConfig: { ...baseStats.effectiveConfig, summaryOnly: true }, counts: { ...baseStats.counts, flowsEmitted: 0 } },
  summaries: [summaryRow]
});
assert.equal(summaryOnlyPack.risk?.analysisStatus?.code, 'summary_only');
assertStrictFail(path.join(tempRoot, 'summary-only', 'index-code'));

const missingPack = await buildPack({ name: 'missing' });
assert.equal(missingPack.risk?.analysisStatus?.code, 'missing');
assertStrictFail(path.join(tempRoot, 'missing', 'index-code'));

const cappedPack = await buildPack({
  name: 'capped',
  stats: { ...baseStats, counts: { ...baseStats.counts, flowsEmitted: 2 } },
  summaries: [summaryRow],
  flows: [hugeFlow, normalFlow]
});
assert.equal(cappedPack.risk?.analysisStatus?.code, 'capped');
assertStrictFail(path.join(tempRoot, 'capped', 'index-code'));

const invalidPack = await buildPack({
  name: 'invalid',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [normalFlow],
  invalidFlows: true
});
assert.equal(invalidPack.risk?.analysisStatus?.code, 'schema_invalid');
assertStrictFail(path.join(tempRoot, 'invalid', 'index-code'));

const zeroFlowPack = await buildPack({
  name: 'zero-flow',
  stats: { ...baseStats, counts: { ...baseStats.counts, flowsEmitted: 0, uniqueCallSitesReferenced: 0 } },
  summaries: [summaryRow]
});
assert.equal(zeroFlowPack.risk?.analysisStatus?.code, 'ok');
assert.doesNotThrow(() => assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-primary' },
  chunkMeta,
  repoRoot,
  indexDir: path.join(tempRoot, 'zero-flow', 'index-code'),
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  riskStrict: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  now: fixedNow,
  indexCompatKey: 'compat-strict'
}));

console.log('context pack risk strict status test passed');
