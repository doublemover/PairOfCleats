#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  computeRiskScenario,
  createRiskRuntime,
  createRiskSanitizerChunk,
  createRiskSinkChunk,
  createRiskSourceChunk
} from './helpers/risk-flow-fixtures.js';

const chunks = [
  createRiskSourceChunk({
    callLine: 3,
    callee: 'sanitize',
    targetChunkUid: 'uid-sanitize'
  }),
  createRiskSanitizerChunk(),
  createRiskSinkChunk()
];

const terminateResult = computeRiskScenario({
  chunks,
  runtime: createRiskRuntime({ sanitizerPolicy: 'terminate' })
});
assert.equal(terminateResult.flowRows.length, 0, 'terminate should stop propagation past sanitizer');

const weakenResult = computeRiskScenario({
  chunks,
  runtime: createRiskRuntime({ sanitizerPolicy: 'weaken' })
});
assert.equal(weakenResult.flowRows.length, 1, 'weaken should allow propagation');
assert.equal(weakenResult.flowRows[0].notes.sanitizerBarriersHit, 1, 'should record sanitizer barrier');

console.log('risk interprocedural sanitizer policy test passed');
