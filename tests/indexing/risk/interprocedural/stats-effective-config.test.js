#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';

const runtime = {
  riskInterproceduralEnabled: false,
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'conservative',
    emitArtifacts: 'jsonl',
    sanitizerPolicy: 'terminate',
    semantics: [
      {
        id: 'sem.callback.register-handler-payload',
        kind: 'callback',
        name: 'register handler payload handoff',
        frameworks: ['express'],
        languages: ['javascript'],
        patterns: ['\\bregisterHandler\\b'],
        fromArgs: [1],
        taintHints: ['payload']
      }
    ],
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
assert.deepEqual(
  result.stats?.effectiveConfig?.semantics,
  [
    {
      id: 'sem.callback.register-handler-payload',
      kind: 'callback',
      name: 'register handler payload handoff',
      frameworks: ['express'],
      languages: ['javascript'],
      patterns: ['\\bregisterHandler\\b'],
      fromArgs: [1],
      toParams: [],
      taintHints: ['payload']
    }
  ],
  'effectiveConfig should preserve semantics registry for provenance fingerprinting'
);

console.log('risk interprocedural stats effective config test passed');
