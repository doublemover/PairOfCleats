#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-risk-seed-anchoring');
const repoRoot = path.join(tempRoot, 'repo');
const repoFile = path.join(repoRoot, 'src', 'file.js');
const fixedNow = () => '2026-03-12T00:00:00.000Z';

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.writeFile(repoFile, 'export const source = 1;\nexport const sink = 2;\n', 'utf8');

const chunkMeta = [
  { id: 0, file: 'src/file.js', chunkUid: 'chunk-source', start: 0, end: 20, startLine: 1, endLine: 1 },
  { id: 1, file: 'src/file.js', chunkUid: 'chunk-mid', start: 21, end: 40, startLine: 2, endLine: 2 },
  { id: 2, file: 'src/file.js', chunkUid: 'chunk-sink', start: 41, end: 60, startLine: 3, endLine: 3 }
];

const summaryRows = [
  {
    schemaVersion: 1,
    chunkUid: 'chunk-sink',
    file: 'src/file.js',
    languageId: 'javascript',
    symbol: { name: 'sink', kind: 'VariableDeclarator', signature: 'sink' },
    signals: { sources: [], sinks: [], sanitizers: [], localFlows: [] },
    totals: { sources: 0, sinks: 1, sanitizers: 0, localFlows: 0 },
    truncated: { sources: false, sinks: false, sanitizers: false, localFlows: false, evidence: false }
  }
];

const flows = [
  {
    schemaVersion: 1,
    flowId: 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    source: { chunkUid: 'chunk-source', ruleId: 'source.input', ruleName: 'input', ruleType: 'source', category: 'input', severity: 'low', confidence: 0.6 },
    sink: { chunkUid: 'chunk-outside', ruleId: 'sink.log', ruleName: 'log', ruleType: 'sink', category: 'logging', severity: 'medium', confidence: 0.7 },
    path: { chunkUids: ['chunk-source', 'chunk-outside'], callSiteIdsByStep: [[]] },
    confidence: 0.7,
    notes: { strictness: 'conservative', sanitizerPolicy: 'terminate', hopCount: 1, sanitizerBarriersHit: 0, capsHit: [] }
  },
  {
    schemaVersion: 1,
    flowId: 'sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    source: { chunkUid: 'chunk-other', ruleId: 'source.other', ruleName: 'other', ruleType: 'source', category: 'input', severity: 'low', confidence: 0.5 },
    sink: { chunkUid: 'chunk-sink', ruleId: 'sink.exec', ruleName: 'exec', ruleType: 'sink', category: 'exec', severity: 'high', confidence: 0.95 },
    path: { chunkUids: ['chunk-other', 'chunk-mid', 'chunk-sink'], callSiteIdsByStep: [[]] },
    confidence: 0.95,
    notes: { strictness: 'conservative', sanitizerPolicy: 'terminate', hopCount: 2, sanitizerBarriersHit: 0, capsHit: [] }
  }
];

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
      compatibilityKey: 'compat-anchor',
      generatedAt: fixedNow(),
      mode: 'code',
      stage: 'context-pack-risk-anchor',
      pieces
    }
  });
};

const indexDir = path.join(tempRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await writeJsonObjectFile(path.join(indexDir, 'risk_interprocedural_stats.json'), {
  fields: {
    schemaVersion: 1,
    generatedAt: fixedNow(),
    mode: 'code',
    status: 'ok',
    reason: null,
    effectiveConfig: { enabled: true, summaryOnly: false, emitArtifacts: 'jsonl' },
    counts: { flowsEmitted: 2, summariesEmitted: 1, uniqueCallSitesReferenced: 0 },
    callSiteSampling: { strategy: 'firstN', maxCallSitesPerEdge: 0, order: 'deterministic' },
    capsHit: [],
    timingMs: { summaries: 1, propagation: 1, io: 1, total: 3 }
  }
});
await writeJsonl(path.join(indexDir, 'risk_summaries.jsonl'), summaryRows);
await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), flows);
await writeManifest(indexDir, [
  { name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' },
  { name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' },
  { name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' }
]);

const anchoredPack = assembleCompositeContextPack({
  seed: {
    status: 'ambiguous',
    resolved: { chunkUid: 'chunk-mid' },
    candidates: [{ chunkUid: 'chunk-sink' }, { chunkUid: 'chunk-source' }]
  },
  chunkMeta,
  repoRoot,
  indexDir,
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  now: fixedNow,
  indexCompatKey: 'compat-anchor'
});

assert.equal(anchoredPack.risk?.anchor?.kind, 'sink');
assert.equal(anchoredPack.risk?.anchor?.chunkUid, 'chunk-sink');
assert.equal(anchoredPack.risk?.anchor?.flowId, 'sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
assert.equal(anchoredPack.risk?.anchor?.alternateCount, 2);
assert.equal(anchoredPack.risk?.flows?.[0]?.flowId, 'sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
assert.equal(anchoredPack.risk?.summary?.chunkUid, 'chunk-sink');
assert.ok(anchoredPack.warnings?.some((entry) => entry?.code === 'RISK_ANCHOR_ALTERNATES'));
assert.equal(validateCompositeContextPack(anchoredPack).ok, true);

const unresolvedPack = assembleCompositeContextPack({
  seed: {
    status: 'unresolved',
    candidates: [{ chunkUid: 'chunk-missing' }]
  },
  chunkMeta,
  repoRoot,
  indexDir,
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  now: fixedNow,
  indexCompatKey: 'compat-anchor'
});

assert.equal(unresolvedPack.risk?.status, 'missing');
assert.equal(unresolvedPack.risk?.analysisStatus?.code, 'missing');
assert.equal(unresolvedPack.risk?.anchor?.kind, 'unresolved');
assert.ok(unresolvedPack.warnings?.some((entry) => entry?.code === 'MISSING_RISK'));

const fileSeedPack = assembleCompositeContextPack({
  seed: { type: 'file', path: 'src/file.js' },
  chunkMeta,
  repoRoot,
  indexDir,
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  now: fixedNow,
  indexCompatKey: 'compat-anchor'
});

assert.equal(fileSeedPack.risk?.anchor?.kind, 'source');
assert.equal(fileSeedPack.risk?.anchor?.alternateCount >= 1, true);
assert.equal(fileSeedPack.risk?.flows?.[0]?.flowId, 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

console.log('context pack risk seed anchoring test passed');
