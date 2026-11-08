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

assert.equal(result.stats.executionStatus, 'completed');
assert.equal(result.status, 'partial', 'completed summary-only execution cannot qualify unknown cross-file input');
assert.equal(result.stats.inputCoverage.upstreamCoverage.admission.status, 'unknown');
assert.deepEqual(result.flowRows, [], 'malformed chunk collections should not emit flows');

console.log('interprocedural engine shape guard test passed');
