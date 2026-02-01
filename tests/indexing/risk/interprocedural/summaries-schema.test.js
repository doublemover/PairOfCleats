#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';

const chunk = {
  file: 'src/sample.js',
  lang: 'javascript',
  chunkUid: 'uid-sample',
  name: 'f',
  kind: 'Function',
  startLine: 10,
  docmeta: {
    signature: 'function f() {}',
    risk: {
      sources: [
        {
          id: 'source.secret',
          name: 'secret',
          ruleType: 'source',
          category: 'secrets',
          severity: 'low',
          confidence: 0.6,
          tags: ['a', 'b'],
          evidence: { line: 1, column: 2, excerpt: 'SECRET' }
        }
      ],
      sinks: [
        {
          id: 'sink.log',
          name: 'log',
          ruleType: 'sink',
          category: 'logging',
          severity: 'medium',
          confidence: 0.7,
          tags: ['x'],
          evidence: { line: 3, column: 1, excerpt: 'console.log' }
        }
      ],
      sanitizers: [],
      flows: [
        {
          ruleIds: ['source.secret', 'sink.log'],
          category: 'logging',
          severity: 'medium',
          confidence: 0.5,
          evidence: { line: 4, column: 5, excerpt: 'flow' }
        }
      ]
    }
  }
};

const { rows } = buildRiskSummaries({
  chunks: [chunk],
  interprocedural: { enabled: true, summaryOnly: false }
});

assert.equal(rows.length, 1, 'expected one summary row');
const row = rows[0];
assert.equal(row.schemaVersion, 1);
assert.equal(row.chunkUid, 'uid-sample');
assert.equal(row.file, 'src/sample.js');
assert.ok(row.signals, 'signals missing');
assert.ok(Array.isArray(row.signals.sources));
assert.ok(Array.isArray(row.signals.sinks));
assert.ok(Array.isArray(row.signals.sanitizers));
assert.ok(Array.isArray(row.signals.localFlows));
assert.equal(row.totals.sources, 1);
assert.equal(row.totals.sinks, 1);
assert.equal(row.totals.sanitizers, 0);
assert.equal(row.totals.localFlows, 1);

const evidence = row.signals.sources[0].evidence[0];
assert.equal(evidence.startLine, evidence.endLine);
assert.equal(evidence.startCol, evidence.endCol);
assert.ok(evidence.snippetHash?.startsWith('sha1:'), 'snippetHash should be sha1');

console.log('risk summaries schema test passed');
