#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';

const malformed = buildRiskSummaries({
  chunks: { malformed: true },
  runtime: null,
  mode: 'code'
});
assert.deepEqual(malformed.rows, [], 'non-iterable chunk collections should be ignored safely');
assert.equal(malformed.stats.candidates, 0);

const iterable = buildRiskSummaries({
  chunks: new Set([
    {
      chunkUid: 'chunk-a',
      file: 'src/a.js',
      lang: 'javascript',
      docmeta: {
        signature: 'a()',
        risk: {
          sources: [{ id: 'source.a', name: 'A', evidence: { line: 1, column: 1, excerpt: 'A' } }],
          sinks: [],
          sanitizers: [],
          flows: []
        }
      }
    }
  ]),
  runtime: null,
  mode: 'code'
});
assert.equal(iterable.rows.length, 1, 'iterable chunk collections should still be processed');

console.log('risk summaries shape guard test passed');
