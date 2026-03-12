#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runFlowCapScenario } from './helpers/flow-cap-matrix.js';

applyTestEnv();

const maxDepthResult = runFlowCapScenario({
  caps: { maxDepth: 1, maxPartialFlows: 4 }
});
assert.equal(maxDepthResult.status, 'ok');
assert.equal(maxDepthResult.flowRows.length, 1, 'expected full flow to still be emitted before depth cap');
assert.equal(maxDepthResult.partialFlowRows.length, 1, 'expected one partial flow from the depth cap');
assert.equal(maxDepthResult.partialFlowRows[0]?.frontier?.terminalReason, 'maxDepth');
assert.deepEqual(maxDepthResult.partialFlowRows[0]?.path?.chunkUids, ['uid-source', 'uid-sink']);
assert.equal(maxDepthResult.partialFlowRows[0]?.notes?.terminalReason, 'maxDepth');
assert.ok(
  Array.isArray(maxDepthResult.partialFlowRows[0]?.notes?.capsHit)
  && maxDepthResult.partialFlowRows[0].notes.capsHit.includes('maxDepth'),
  'expected partial flow to record the maxDepth cap'
);
assert.equal(maxDepthResult.stats?.counts?.partialFlowsEmitted, 1);

const blockedExpansionResult = runFlowCapScenario({
  caps: { maxEdgeExpansions: 1, maxPartialFlows: 4 },
  nowStepMs: 0
});
assert.equal(blockedExpansionResult.status, 'ok');
assert.equal(blockedExpansionResult.flowRows.length, 1, 'expected the direct flow to be emitted');
assert.equal(blockedExpansionResult.partialFlowRows.length, 1, 'expected one blocked partial flow');
assert.equal(blockedExpansionResult.partialFlowRows[0]?.frontier?.terminalReason, 'noCallees');
assert.deepEqual(
  blockedExpansionResult.partialFlowRows[0]?.frontier?.blockedExpansions,
  [],
  'expected terminal sink partial flow without blocked expansions in the helper graph'
);
assert.equal(blockedExpansionResult.stats?.counts?.partialFlowsEmitted, 1);

const timedOutResult = runFlowCapScenario({
  caps: { maxMs: 10, maxPartialFlows: 4 },
  nowStepMs: 20
});
assert.equal(timedOutResult.status, 'timed_out');
assert.equal(timedOutResult.flowRows.length, 0, 'timeout should not emit full flows');
assert.equal(timedOutResult.partialFlowRows.length, 1, 'timeout should emit one retained partial frontier');
assert.equal(timedOutResult.partialFlowRows[0]?.frontier?.terminalReason, 'maxMs');
assert.ok(
  Array.isArray(timedOutResult.partialFlowRows[0]?.notes?.capsHit)
  && timedOutResult.partialFlowRows[0].notes.capsHit.includes('maxMs'),
  'expected timeout partial flow to record maxMs'
);
assert.equal(timedOutResult.stats?.counts?.flowsEmitted, 0);
assert.equal(timedOutResult.stats?.counts?.partialFlowsEmitted, 1);

console.log('risk interprocedural partial flows test passed');
