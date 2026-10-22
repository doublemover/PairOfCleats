import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRiskWitness, materializeRiskWitness, matchesRiskWitnessExtension } from '../../../../src/index/risk-interprocedural/witness.js';
import { createRiskStateQueue } from '../../../../src/index/risk-interprocedural/state-queue.js';
import { computeRiskScenario, createRiskRuntime, createRiskSourceChunk, createRiskSinkChunk } from './helpers/risk-flow-fixtures.js';

const root = createRiskWitness({ chunkUid: 'root' });
const prefix = createRiskWitness({ parent: root, chunkUid: 'shared', callSiteIds: ['one'], watch: { confidenceAfter: 0.5 } });
const left = createRiskWitness({ parent: prefix, chunkUid: 'left', callSiteIds: ['left-call'], watch: { calleeNormalized: 'left' } });
const right = createRiskWitness({ parent: prefix, chunkUid: 'right', callSiteIds: ['right-call'], watch: { calleeNormalized: 'right' } });
assert.equal(left.parent, right.parent, 'branching paths retain one shared prefix');
assert.equal(Object.hasOwn(left, 'pathChunkUids'), false, 'admitted nodes do not retain full path arrays');
assert.ok(matchesRiskWitnessExtension(left, prefix, JSON.stringify(['left-call'])));
const expanded = materializeRiskWitness(left);
assert.deepEqual(expanded.chunkUids, ['root', 'shared', 'left']);
assert.deepEqual(expanded.callSiteIdsByStep, [['one'], ['left-call']]);
expanded.callSiteIdsByStep[0].push('caller mutation');
assert.deepEqual(materializeRiskWitness(right).callSiteIdsByStep, [['one'], ['right-call']]);

const queue = createRiskStateQueue(), states = [];
const spellings = ['a', 'a"', 'a\\', 'a\n', 'ab', 'z'];
for (let ordinal = 0; ordinal < 48; ordinal++) {
  const source = { chunkUid: spellings[ordinal % spellings.length], source: { ruleId: `rule-${ordinal % 3}` } };
  const first = createRiskWitness({ chunkUid: source.chunkUid });
  const second = createRiskWitness({ parent: first, chunkUid: spellings[(ordinal + 2) % spellings.length], callSiteIds: ordinal % 2 ? ['c', 'd'] : ['c"'] });
  const witness = createRiskWitness({ parent: second, chunkUid: `leaf-${ordinal % 4}`, callSiteIds: ['call'], watch: {} });
  const state = { rootSource: source, witness, depth: 2, sanitizerBarriersHit: ordinal % 2, taintKey: `taint-${ordinal}`, ordinal };
  queue.push(state); states.push(state);
}
const oldOrderKey = state => {
  const path = materializeRiskWitness(state.witness);
  return JSON.stringify([state.rootSource.chunkUid, state.rootSource.source.ruleId, path.chunkUids, path.callSiteIdsByStep, state.taintKey]);
};
states.sort((a, b) => a.depth - b.depth || a.sanitizerBarriersHit - b.sanitizerBarriersHit
  || (oldOrderKey(a) < oldOrderKey(b) ? -1 : oldOrderKey(a) > oldOrderKey(b) ? 1 : 0));
for (const state of states) assert.equal(queue.pop(), state, 'linked comparison preserves the encoded queue tie policy');
assert.equal(queue.length, 0, 'popping releases all queue-owned state slots');
assert.deepEqual(queue.pending(), []);

const result = computeRiskScenario({ chunks: [createRiskSourceChunk(), createRiskSinkChunk()], runtime: createRiskRuntime() });
assert.equal(result.flowRows.length, 1);
const flow = result.flowRows[0], path = flow.path;
assert.deepEqual(path.chunkUids, ['uid-source', 'uid-sink']);
assert.equal(path.callSiteIdsByStep.length, 1);
assert.equal(path.watchByStep.length, 1);
assert.equal(path.watchByStep[0].confidenceBefore, 0.6);
const idSource = `${flow.source.chunkUid}|${flow.source.ruleId}|${flow.sink.chunkUid}|${flow.sink.ruleId}|${path.chunkUids.join('>')}`;
assert.equal(flow.flowId, `sha1:${createHash('sha1').update(idSource).digest('hex')}`);
const timedOut = computeRiskScenario({ chunks: [createRiskSourceChunk(), createRiskSinkChunk()],
  runtime: createRiskRuntime({ caps: { maxMs: 1, maxPartialFlows: 4 } }), nowStepMs: 2 });
assert.equal(timedOut.status, 'timed_out');
assert.deepEqual(timedOut.partialFlowRows[0].path, { chunkUids: ['uid-source'], callSiteIdsByStep: [], watchByStep: [] });
console.log('Parent-linked risk witnesses preserve output identities, encoded priority, watch steps and timeout frontiers.');
