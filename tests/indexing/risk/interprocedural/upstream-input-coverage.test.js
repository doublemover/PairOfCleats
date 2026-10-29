import assert from 'node:assert/strict';
import { detectRiskSignals, normalizeRiskConfig } from '../../../../src/index/risk.js';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';
import { createRiskSourceConsumerCase } from '../../../helpers/risk-source-consumer.js';

const runtime = { riskInterproceduralEnabled: true, riskInterproceduralConfig: { enabled: true, summaryOnly: false,
  caps: { maxDepth: 4, maxTotalFlows: 20, maxPathsPerPair: 3, maxEdgeExpansions: 20, maxMs: null } } };
const text = 'const ordinary = 123456789;';
const chunk = { file: 'fixture.js', chunkUid: 'fixture', startLine: 1, docmeta: {} };
const analyze = caps => {
  chunk.docmeta.risk = detectRiskSignals({ text, config: normalizeRiskConfig({ caps }) });
  const { rows, stats } = buildRiskSummaries({ chunks: [chunk], runtime, mode: 'code' });
  return computeInterproceduralRisk({ chunks: [chunk], summaries: rows, summaryStats: stats, runtime });
};
const capped = analyze({ maxBytes: 10 });
assert.equal(capped.stats.executionStatus, 'completed');
assert.equal(capped.stats.inputCoverage.status, 'partial');
assert.ok(capped.stats.capsHit.includes('upstream:maxBytes'));
assert.equal(capped.flowRows.length, 0);
const complete = analyze({ maxBytes: 10000 });
assert.equal(complete.summaryRows[0].inputCoverage.status, 'complete', 'the uncapped local analysis is complete');
assert.equal(complete.stats.inputCoverage.upstreamCoverage.analysis.status, 'unknown');
assert.equal(complete.stats.inputCoverage.status, 'partial', 'local completion cannot qualify absent cross-file evidence');
assert.equal(complete.status, 'partial');
assert.equal(complete.flowRows.length, 0, 'a legitimate complete local zero-risk result remains empty');
chunk.docmeta.risk = { analysisStatus: { status: 'ok', caps: {}, bytes: 1, lines: 1 },
  sources: Array.from({ length: 60 }, (_, n) => ({ id: `s${n}`, name: `s${n}`, tags: Array.from({ length: 12 }, (_, i) => `tag${i}`),
    evidence: Array.from({ length: 8 }, (_, i) => ({ line: i + 1, column: 1, excerpt: 'evidence' })) })),
  sinks: [], sanitizers: [], flows: [], taintHints: { taintedIdentifiers: Array.from({ length: 60 }, (_, n) => `v${n}`) } };
const reduced = buildRiskSummaries({ chunks: [chunk], runtime, mode: 'code' });
assert.equal(reduced.rows[0].inputCoverage.losses.sources, 10);
assert.ok(reduced.rows[0].inputCoverage.losses.tags > 0);
assert.ok(reduced.rows[0].inputCoverage.losses.evidence > 0);
assert.equal(reduced.rows[0].inputCoverage.losses.taintIdentifiers, 10);
const dropped = computeInterproceduralRisk({ chunks: [], summaries: [], runtime,
  summaryStats: { summariesDroppedBySize: 2, droppedChunks: [{ chunkUid: 'dropped', reason: 'rowTooLarge' }] } });
assert.equal(dropped.stats.inputCoverage.droppedRows, 2);
assert.equal(dropped.stats.inputCoverage.droppedChunkWitnessesOmitted, 1);
assert.equal(dropped.status, 'partial');
const surviving = await createRiskSourceConsumerCase();
assert.equal(surviving.result.flowRows.length, 1, 'the actual uncapped source detector reaches the other authored chunk sink');
assert.equal(surviving.result.summaryRows[0].inputCoverage.status, 'complete');
assert.equal(surviving.result.stats.executionStatus, 'completed');
assert.equal(surviving.result.stats.inputCoverage.upstreamCoverage.analysis.status, 'unknown', 'local success cannot fabricate unrelated cross-file completeness');
for (const [reason, options] of [
  ['maxBytes', { caps: { maxBytes: 10 } }], ['maxLines', { caps: { maxLines: 1 } }],
  ['maxNodes', { caps: { maxNodes: 1 }, sourceText: 'const value=SOURCE;\nconst alias=value;\nS(alias);' }],
  ['maxEdges', { caps: { maxEdges: 1 }, sourceText: 'const value=SOURCE;\nconst alias=value;\nS(alias);' }],
  ['maxFlows', { caps: { maxFlows: 1 }, sourceText: 'const value=SOURCE;\nSINK(value);\nSINK_ALT(value);\nS(value);' }],
  ['maxMs', { caps: { maxMs: 1 }, clockStep: 10 }]
]) {
  const value = await createRiskSourceConsumerCase(options);
  assert.equal(value.chunks[0].docmeta.risk.analysisStatus.status, 'capped');
  assert.ok(value.result.stats.capsHit.includes('upstream:' + reason), reason);
  assert.equal(value.result.stats.executionStatus, 'completed');
  assert.notEqual(value.result.stats.inputCoverage.status, 'complete');
  assert.equal(value.result.summaryRows.find(row => row.chunkUid === value.chunks[0].chunkUid).inputCoverage.localAnalysis.reason, reason);
}
console.log('Local admission and summary reductions survive zero-flow completion.');
