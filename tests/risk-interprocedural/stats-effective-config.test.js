#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeInterproceduralRisk } from '../../src/index/risk-interprocedural/engine.js';

const runtime = {
  riskInterproceduralEnabled: false,
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'conservative',
    emitArtifacts: 'jsonl',
    sanitizerPolicy: 'terminate',
    caps: {}
  }
};

const result = computeInterproceduralRisk({
  chunks: [],
  summaries: [],
  runtime
});

assert.equal(result.stats?.status, 'disabled', 'stats should report disabled when gated off');
assert.equal(
  result.stats?.effectiveConfig?.enabled,
  false,
  'effectiveConfig.enabled should reflect runtime gating'
);

console.log('risk interprocedural stats effective config test passed');
