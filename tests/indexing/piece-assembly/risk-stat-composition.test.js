import assert from 'node:assert/strict';
import { mergePieceRiskStats } from '../../../src/index/build/piece-assembly/risk-stats.js';

const state = { riskSummaries: [{}], riskFlows: [{}], riskPartialFlows: [] }, mergeState = {};
const first = { schemaVersion: 1, mode: 'code', status: 'ok', effectiveConfig: { maxDepth: 2 },
  counts: { flowsEmitted: 1, resolvedEdges: 4 }, capsHit: ['maxDepth'], timingMs: { total: 3 },
  provenance: { indexSignature: 'first' }, callSiteSampling: { strategy: 'firstN' } };
const second = { ...first, status: 'error', effectiveConfig: { maxDepth: 3 },
  counts: { flowsEmitted: 2, resolvedEdges: 7 }, capsHit: ['maxDepth', 'maxPaths'], timingMs: { total: 5 },
  error: 'controlled second piece error', provenance: { indexSignature: 'second' } };
mergePieceRiskStats({ input: { riskInterproceduralStats: first }, dir: 'first', state, mergeState });
assert.deepEqual(state.riskInterproceduralStats, first);
state.riskSummaries.push({}, {}); state.riskFlows.push({}, {});
mergePieceRiskStats({ input: { riskInterproceduralStats: second }, dir: 'second', state, mergeState });
const result = state.riskInterproceduralStats;
assert.equal(result.counts.flowsEmitted, 3);
assert.equal(result.counts.summariesEmitted, 3);
assert.deepEqual(result.capsHit, ['maxDepth', 'maxPaths']);
assert.equal(result.timingMs.total, 8);
assert.equal(result.status, 'partial');
assert.equal(result.assembly.composable, false);
assert.equal(result.assembly.compatibleConfig, false);
assert.equal(result.assembly.inputs[1].stats.error, 'controlled second piece error');
assert.equal(result.assembly.inputs[1].stats.provenance.indexSignature, 'second');
assert.equal(Object.hasOwn(result.counts, 'resolvedEdges'), false, 'non-composable unique counts remain per-input evidence');
assert.equal(result.provenance, null, 'input provenance cannot impersonate the assembled output');
assert.deepEqual(first.counts, { flowsEmitted: 1, resolvedEdges: 4 });
state.riskFlows.push({});
mergePieceRiskStats({ input: {}, dir: 'missing-stats', state, mergeState });
assert.equal(state.riskInterproceduralStats.counts.flowsEmitted, 4);
assert.equal(state.riskInterproceduralStats.assembly.inputs.at(-1).stats, null);
assert.equal(state.riskInterproceduralStats.status, 'partial');
console.log('Assembly preserves every piece risk receipt and marks independent analyses non-composable.');
