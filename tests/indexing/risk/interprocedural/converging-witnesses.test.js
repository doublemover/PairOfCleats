import assert from 'node:assert/strict';
import { computeRiskScenario, createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk } from './helpers/risk-flow-fixtures.js';
const call = (targetChunkUid, line) => ({ callee: targetChunkUid, calleeRaw: targetChunkUid,
  calleeNormalized: targetChunkUid, targetChunkUid, args: ['value'], startLine: line,
  startCol: 1, endLine: line, endCol: 10 });
const middle = (uid, targets) => ({ chunkUid: uid, file: `${uid}.js`, name: uid,
  kind: 'Function', startLine: 1, docmeta: {}, codeRelations: {
    callDetails: targets.map((target, i) => call(target, i + 1))
  } });
const source = createRiskSourceChunk();
source.codeRelations.callDetails = [call('uid-left', 2), call('uid-right', 3)];
const chunks = [source, middle('uid-left', ['uid-join']), middle('uid-right', ['uid-join']),
  middle('uid-join', ['uid-sink']), createRiskSinkChunk()];
const runtime = createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 2, maxPartialFlows: 10, maxBlockedExpansionsPerPartial: 10 } });
const result = computeRiskScenario({ chunks, runtime });
assert.equal(result.flowRows.length, 2, 'both diamond predecessors survive convergence');
assert.deepEqual(result.flowRows.map(row => row.path.chunkUids).sort(), [
  ['uid-source', 'uid-left', 'uid-join', 'uid-sink'],
  ['uid-source', 'uid-right', 'uid-join', 'uid-sink']
]);
assert.equal(new Set(result.flowRows.map(row => row.flowId)).size, 2);
assert.ok(result.flowRows.every(row => row.path.callSiteIdsByStep.length === 3 && row.path.callSiteIdsByStep.every(step => step.length === 1)));
assert.notDeepEqual(result.flowRows[0].path.callSiteIdsByStep[0], result.flowRows[1].path.callSiteIdsByStep[0],
  'both same-depth paths retain their own independent root call-site witness');
const projection = value => value.flowRows.map(row => ({ id: row.flowId, path: row.path }));
assert.deepEqual(projection(computeRiskScenario({ chunks: [...chunks].reverse(), runtime })), projection(result),
  'input order cannot change deterministic retained flow identities or witness order');
const one = computeRiskScenario({ chunks, runtime: createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 1, maxPartialFlows: 10, maxBlockedExpansionsPerPartial: 10 } }) });
assert.equal(one.flowRows.length, 1); assert.ok(one.stats.capsHit.includes('maxPathsPerPair'));
assert.ok(one.partialFlowRows.some(row => row.notes.capsHit.includes('maxPathsPerPair')));
const expanded = computeRiskScenario({ chunks, runtime: createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 2, maxEdgeExpansions: 1, maxPartialFlows: 10 } }) });
assert.ok(expanded.stats.capsHit.includes('maxEdgeExpansions')); assert.ok(expanded.partialFlowRows.length > 0);
const timed = computeRiskScenario({ chunks, runtime: createRiskRuntime({ caps: { maxMs: 1, maxPartialFlows: 10 } }), nowStepMs: 10 });
assert.ok(timed.stats.capsHit.includes('maxMs')); assert.ok(timed.partialFlowRows.length > 0);
chunks[3].codeRelations.callDetails.push(call('uid-left', 4));
const cycle = computeRiskScenario({ chunks, runtime });
assert.ok(cycle.stats.capsHit.includes('maxDepth'));
assert.ok(cycle.flowRows.length <= 2, 'cycle expansion remains bounded by existing depth and pair caps');
console.log('converging risk witnesses passed');
