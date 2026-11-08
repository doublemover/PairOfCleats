import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { measureRiskBudgetValue } from '../../src/context-pack/assemble/risk-budget-measure.js';
import { admitRiskFlowEnvelope, estimateRiskByteSize, estimateRiskTokenCount } from '../../src/context-pack/assemble/budgets.js';
import { normalizeRiskCallSiteDetails } from '../../src/context-pack/assemble/call-sites.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { clearContextPackCaches } from '../../src/context-pack/excerpt-cache.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { buildRiskFlow, buildRiskSummary, buildRiskStatsFields, buildRiskCallSite } from '../helpers/risk-pack-eval.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const sink = () => { const hits = new Set(), truncation = []; return { riskCapHits: hits, recordRiskTruncation: (cap, detail) => truncation.push({ cap, ...detail }), hits, truncation }; };
if (selected === 'measurement') {
  const shared = { details: 'same data charged again' };
  for (const value of [{ text: 'ASCII " \\ \n\t\u0000 β 中文 😀 \ud800', empty: null, nan: NaN },
    [shared, shared, undefined, -0, false], { absent: undefined, array: ['foo/bar:cfg', 'a+++b'] }]) {
    const actual = measureRiskBudgetValue(value, { maxBytes: 4096, maxTokens: 2048 });
    assert.deepEqual(actual, { bytes: Buffer.byteLength(JSON.stringify(value)), tokens: estimateRiskTokenCount(value), exactBytes: true, exactTokens: true });
  }
  const giant = 'x'.repeat(4 * 1024 * 1024), value = { metadata: giant }, original = JSON.stringify;
  JSON.stringify = function(input, ...args) { assert.notEqual(input, value); assert.notEqual(input, giant, 'oversized metadata must be refused before encoding'); return Reflect.apply(original, JSON, [input, ...args]); };
  try {
    const denied = measureRiskBudgetValue(value, { maxBytes: 24576, maxTokens: 2048 });
    assert.equal(denied.exactBytes, false); assert.equal(denied.bytes, 24577); assert.equal(denied.tokens, null);
  } finally { JSON.stringify = original; }
  const hostile = Object.defineProperty({}, 'metadata', { enumerable: true, get() { assert.fail('measurement cannot invoke payload accessors'); } });
  assert.throws(() => measureRiskBudgetValue(hostile, { maxBytes: 4096, maxTokens: 2048 }), /accessors/u);
} else if (selected === 'envelope-boundaries') {
  const base = { rank: 1, value: '' }, limit = 24576;
  const exact = { ...base, value: 'x'.repeat(limit - estimateRiskByteSize([base])) };
  assert.equal(estimateRiskByteSize([exact]), limit);
  const state = sink(), accepted = admitRiskFlowEnvelope({ flows: [exact], ...state, stage: 'test' });
  assert.deepEqual(accepted.flows, [exact]); assert.equal(accepted.bytes, limit); assert.equal(accepted.tokens, estimateRiskTokenCount([exact]));
  const denied = admitRiskFlowEnvelope({ flows: [{ ...exact, value: exact.value + 'x' }], ...sink(), stage: 'test' });
  assert.equal(denied.flows.length, 0); assert.equal(denied.bytes, 2); assert.equal(denied.omittedFlows, 1);
  const tokenHeavy = { rank: 1, value: 'a+'.repeat(2100) }, tokens = sink();
  const rejected = admitRiskFlowEnvelope({ flows: [tokenHeavy], ...tokens, stage: 'test' });
  assert.equal(rejected.omittedFlows, 1); assert.ok(tokens.hits.has('maxRiskTokens'));
  let hydration = 0;
  admitRiskFlowEnvelope({ flows: [{ rank: 1, value: 'x'.repeat(24577) }], ...sink(), stage: 'test', hydrate: () => { hydration++; } });
  assert.equal(hydration, 0, 'a metadata-rejected candidate never requests hydration');
  assert.throws(() => admitRiskFlowEnvelope({ flows: [base], ...sink(), stage: 'test', hydrate: () => undefined }),
    /complete flow object/u, 'a failed hydration producer cannot become a null flow that appears to fit');
} else {
  assert.ok(['full-metadata', 'partial-metadata', 'accumulated', 'actual-exact-fit', 'positive-source'].includes(selected));
  const { dir } = await prepareIsolatedTestCacheDir(`risk-hydrated-${selected}`), repoRoot = path.join(dir, 'repo');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  const source = 'export function risky(input) { return query(input); }\n';
  await fs.writeFile(path.join(repoRoot, 'src', 'seed.js'), source);
  const targets = new Set(), opens = new Map();
  const key = file => typeof file === 'string' ? (process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)) : null;
  const callSiteId = n => 'sha1:' + String(n + 1).padStart(40, '0');
  const flows = Array.from({ length: selected === 'accumulated' ? 5 : 1 }, (_, n) => buildRiskFlow({ alias: String(n), flowId: 'sha1:' + String(n + 1).padStart(40, '0'),
    callSiteIdsByStep: [[callSiteId(n)]] }));
  const rows = flows.map((_, n) => buildRiskCallSite({ callSiteId: callSiteId(n), fileRelPath: `src/evidence-${n}.js`, languageId: 'javascript', queryOffset: source.indexOf('query(input)') }));
  for (const row of rows) { const file = path.join(repoRoot, row.file); await fs.writeFile(file, source); targets.add(key(file)); opens.set(key(file), 0); }
  const partial = { schemaVersion: 1, partialFlowId: 'sha1:' + 'f'.repeat(40), source: flows[0].source,
    frontier: { chunkUid: 'chunk-frontier', terminalReason: 'maxDepth', blockedExpansions: [] },
    path: flows[0].path, confidence: 0.9, notes: { ...flows[0].notes, terminalReason: 'maxDepth' } };
  let serial = 0;
  const build = async (callSites, { partialOnly = false } = {}) => {
    const indexDir = path.join(dir, `index-${++serial}`); await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
    const bodies = {
      risk_interprocedural_stats: buildRiskStatsFields({ generatedAt: '2026-10-27T00:00:00.000Z', flowsEmitted: partialOnly ? 0 : flows.length,
        uniqueCallSitesReferenced: callSites.length, maxCallSitesPerEdge: 3 }).fields,
      risk_summaries: [buildRiskSummary({ fileRelPath: 'src/seed.js', languageId: 'javascript', symbolName: 'risky', symbolKind: 'FunctionDeclaration', signature: 'risky(input)' })],
      risk_flows: partialOnly ? [] : flows, risk_partial_flows: partialOnly ? [partial] : [], call_sites: callSites
    };
    const pieces = [];
    for (const [name, body] of Object.entries(bodies)) {
      const array = Array.isArray(body), file = name + (array ? '.jsonl' : '.json');
      await fs.writeFile(path.join(indexDir, file), array ? body.map(row => JSON.stringify(row)).join('\n') + '\n' : JSON.stringify(body));
      pieces.push({ name, path: file, format: array ? 'jsonl' : 'json' });
    }
    await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: 'risk-hydrated-budget', generatedAt: '2026-10-27T00:00:00.000Z', mode: 'code', stage: 'context-pack-risk', pieces }));
    clearContextPackCaches();
    const originalOpen = fsSync.openSync, originalRead = fsSync.readFileSync;
    fsSync.openSync = function(file, ...args) { const target = key(file); if (targets.has(target)) opens.set(target, opens.get(target) + 1); return Reflect.apply(originalOpen, fsSync, [file, ...args]); };
    fsSync.readFileSync = function(file, ...args) { const target = key(file); if (targets.has(target)) opens.set(target, opens.get(target) + 1); return Reflect.apply(originalRead, fsSync, [file, ...args]); };
    try {
      return assembleCompositeContextPack({ seed: { type: 'chunk', chunkUid: 'chunk-risk' },
        chunkMeta: [{ id: 0, file: 'src/seed.js', chunkUid: 'chunk-risk', start: 0, end: source.length, startLine: 1, endLine: 1 }],
        repoRoot, indexDir, indexSignature: 'hydrated-fixture-source', indexCompatKey: 'risk-hydrated-budget', now: () => '2026-10-27T00:00:00.000Z',
        includeGraph: false, includeTypes: false, includeRisk: true, includeRiskPartialFlows: partialOnly,
        includeImports: false, includeUsages: false, includeCallersCallees: false });
    } finally { fsSync.openSync = originalOpen; fsSync.readFileSync = originalRead; }
  };
  const verify = pack => {
    const { risk } = pack; assert.ok(risk); const counts = risk.caps.observed;
    assert.equal(counts.bytes, estimateRiskByteSize(risk.flows)); assert.equal(counts.tokens, estimateRiskTokenCount(risk.flows));
    assert.equal(counts.partialBytes, estimateRiskByteSize(risk.partialFlows)); assert.equal(counts.partialTokens, estimateRiskTokenCount(risk.partialFlows));
    assert.ok(counts.bytes <= risk.caps.maxBytes && counts.tokens <= risk.caps.maxTokens);
    assert.ok(counts.partialBytes <= risk.caps.maxPartialBytes && counts.partialTokens <= risk.caps.maxPartialTokens);
    assert.equal(counts.selectedFlows + counts.omittedFlows, counts.candidateFlows);
    assert.equal(counts.selectedPartialFlows + counts.omittedPartialFlows, counts.candidatePartialFlows);
    assert.equal(validateCompositeContextPack(pack).ok, true);
  };
  if (selected.endsWith('metadata')) {
    const pack = await build(rows.map(row => ({ ...row, calleeRaw: 'x'.repeat(25 * 1024) })), { partialOnly: selected === 'partial-metadata' });
    verify(pack);
    assert.equal(selected === 'partial-metadata' ? pack.risk.partialFlows.length : pack.risk.flows.length, 0);
    assert.ok(pack.risk.caps.hits.includes(selected === 'partial-metadata' ? 'maxPartialBytes' : 'maxRiskBytes'));
    assert.equal([...opens.values()].reduce((a, b) => a + b, 0), 0, 'provably oversized hydrated metadata never reads source');
  } else if (selected === 'positive-source') {
    const pack = await build(rows); verify(pack);
    assert.equal(pack.risk.flows.length, 1); assert.equal(pack.risk.flows[0].evidence.callSitesByStep[0][0].details.excerpt, 'query(input)');
    assert.ok([...opens.values()].some(count => count > 0), 'the read detector observes actual admitted source hydration');
  } else if (selected === 'actual-exact-fit') {
    const noRange = rows.map(row => ({ ...row, start: 0, end: 0, calleeRaw: 'x' }));
    const baseline = await build(noRange); verify(baseline);
    const extra = baseline.risk.caps.maxBytes - estimateRiskByteSize(baseline.risk.flows);
    const exact = await build(noRange.map(row => ({ ...row, calleeRaw: 'x'.repeat(1 + extra) }))); verify(exact);
    assert.equal(exact.risk.flows.length, 1); assert.equal(exact.risk.caps.observed.bytes, exact.risk.caps.maxBytes);
    const over = await build(noRange.map(row => ({ ...row, calleeRaw: 'x'.repeat(2 + extra) }))); verify(over);
    assert.equal(over.risk.flows.length, 0); assert.ok(over.risk.caps.hits.includes('maxRiskBytes'));
  } else {
    const baseline = await build(rows); verify(baseline); assert.equal(baseline.risk.flows.length, 5);
    const byId = new Map(rows.map(row => [row.callSiteId, normalizeRiskCallSiteDetails(row)]));
    const metadata = baseline.risk.flows.map(flow => ({ ...flow, evidence: { ...flow.evidence,
      callSitesByStep: flow.evidence.callSitesByStep.map(step => step.map(entry => ({ ...entry, details: byId.get(entry.callSiteId) }))) } }));
    const before = estimateRiskByteSize(metadata), after = estimateRiskByteSize(baseline.risk.flows);
    assert.ok(after > before);
    const extra = Math.floor((24576 - before - Math.floor((after - before) / 2)) / 5);
    const expanded = rows.map(row => ({ ...row, calleeRaw: 'x'.repeat(row.calleeRaw.length + extra) }));
    for (const target of opens.keys()) opens.set(target, 0);
    const first = await build(expanded); verify(first);
    assert.ok(first.risk.flows.length > 0 && first.risk.flows.length < 5);
    const retained = new Set(first.risk.flows.map(flow => flow.flowId));
    for (const [index, flow] of flows.entries()) if (!retained.has(flow.flowId)) assert.equal(opens.get(key(path.join(repoRoot, rows[index].file))), 0,
      'remaining metadata allowance rejects a later flow before new source reads');
    const second = await build(expanded); verify(second);
    assert.deepEqual(second.risk.flows, first.risk.flows); assert.deepEqual(second.risk.truncation, first.risk.truncation);
  }
}
console.log(`hydrated risk budget ${selected} control`);
