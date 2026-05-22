#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  computeRiskScenario,
  createRiskRuntime,
  createRiskSinkChunk,
  createRiskSourceChunk
} from './helpers/risk-flow-fixtures.js';

const result = computeRiskScenario({
  chunks: [
    createRiskSourceChunk({ callLine: 3, callArgs: ['safeValue'] }),
    createRiskSinkChunk()
  ],
  runtime: createRiskRuntime({
    strictness: 'argAware',
    sourceRules: [
      {
        id: 'source.req.body',
        patterns: [/req\.body/i]
      }
    ]
  })
});

assert.equal(result.flowRows.length, 0, 'argAware should skip non-tainted args');

console.log('risk interprocedural argAware negative test passed');
