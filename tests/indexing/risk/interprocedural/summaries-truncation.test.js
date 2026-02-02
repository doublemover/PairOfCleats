#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';

const makeEvidence = (index) => ({
  line: index + 1,
  column: 1,
  excerpt: `VALUE_${index}`
});

const sources = Array.from({ length: 60 }, (_, index) => ({
  id: `source.${index}`,
  name: `source-${index}`,
  ruleType: 'source',
  category: 'cat',
  severity: 'low',
  confidence: 0.4,
  tags: Array.from({ length: 12 }, (_, tag) => `tag-${index}-${tag}`),
  evidence: Array.from({ length: 8 }, (_, ev) => makeEvidence(ev + index))
}));

const chunk = {
  file: 'src/truncation.js',
  lang: 'javascript',
  chunkUid: 'uid-trunc',
  name: 'h',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    signature: 'function h() {}',
    risk: {
      sources,
      sinks: [],
      sanitizers: [],
      flows: []
    }
  }
};

const { rows } = buildRiskSummaries({
  chunks: [chunk],
  runtime: {
    riskInterproceduralEnabled: true,
    riskInterproceduralConfig: { summaryOnly: false }
  },
  mode: 'code'
});

assert.equal(rows.length, 1, 'expected one row');
const row = rows[0];
assert.equal(row.totals.sources, 60, 'totals should reflect original size');
assert.equal(row.signals.sources.length, 50, 'sources should be capped');
assert.equal(row.truncated.sources, true, 'sources should be marked truncated');
assert.equal(row.truncated.evidence, true, 'evidence should be marked truncated');
for (const entry of row.signals.sources) {
  assert.ok(entry.evidence.length <= 5, 'evidence should be capped per signal');
}

console.log('risk summaries truncation test passed');
