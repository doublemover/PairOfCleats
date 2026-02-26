#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';

const result = computeInterproceduralRisk({
  chunks: { malformed: true },
  summaries: [],
  runtime: {
    riskInterproceduralEnabled: true,
    riskInterproceduralConfig: {
      enabled: true,
      summaryOnly: true,
      caps: {}
    }
  },
  mode: 'code'
});

assert.equal(result.status, 'ok', 'summary-only mode should complete with malformed chunk collections');
assert.deepEqual(result.flowRows, [], 'malformed chunk collections should not emit flows');

console.log('interprocedural engine shape guard test passed');
