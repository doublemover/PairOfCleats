#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';

const buildChunk = () => ({
  file: 'src/determinism.js',
  lang: 'javascript',
  chunkUid: 'uid-det',
  name: 'g',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    signature: 'function g() {}',
    risk: {
      sources: [
        {
          id: 'source.alpha',
          name: 'alpha',
          ruleType: 'source',
          category: 'alpha',
          severity: 'low',
          confidence: 0.6,
          tags: ['z', 'a'],
          evidence: [
            { line: 3, column: 1, excerpt: 'B' },
            { line: 2, column: 1, excerpt: 'A' }
          ]
        }
      ],
      sinks: [],
      sanitizers: [],
      flows: []
    }
  }
});

const runOnce = () => {
  const { rows } = buildRiskSummaries({
    chunks: [buildChunk()],
    runtime: {
      riskInterproceduralEnabled: true,
      riskInterproceduralConfig: { summaryOnly: false }
    },
    mode: 'code'
  });
  return JSON.stringify(rows);
};

const first = runOnce();
const second = runOnce();
assert.equal(first, second, 'summary output should be deterministic');

console.log('risk summaries determinism test passed');
