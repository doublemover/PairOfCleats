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
const runtime = createRiskRuntime({ caps: { maxDepth: 4, maxPathsPerPair: 2 } });
const result = computeRiskScenario({ chunks, runtime });
assert.equal(result.flowRows.length, 2, 'both diamond predecessors survive convergence');
assert.deepEqual(result.flowRows.map(row => row.path.chunkUids).sort(), [
  ['uid-source', 'uid-left', 'uid-join', 'uid-sink'],
  ['uid-source', 'uid-right', 'uid-join', 'uid-sink']
]);
chunks[3].codeRelations.callDetails.push(call('uid-left', 4));
const cycle = computeRiskScenario({ chunks, runtime });
assert.ok(cycle.stats.capsHit.includes('maxDepth'));
assert.ok(cycle.flowRows.length <= 2, 'cycle expansion remains bounded by existing depth and pair caps');
console.log('converging risk witnesses passed');
