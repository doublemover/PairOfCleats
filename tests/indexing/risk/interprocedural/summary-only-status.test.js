#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';

const sourceChunk = {
  file: 'src/source.js',
  chunkUid: 'uid-source',
  name: 'source',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [
        {
          id: 'source.req.body',
          name: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: 'low',
          confidence: 0.6,
          tags: ['input'],
          evidence: { line: 1, column: 1, excerpt: 'req.body' }
        }
      ],
      sinks: [],
      sanitizers: [],
      flows: []
    }
  }
};

const { rows } = buildRiskSummaries({
  chunks: [sourceChunk],
  interprocedural: { enabled: true, summaryOnly: true }
});

const runtime = {
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: true,
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    emitArtifacts: 'jsonl',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 3,
      maxTotalFlows: 100,
      maxCallSitesPerEdge: 2,
      maxEdgeExpansions: 100,
      maxMs: null
    }
  },
  riskInterproceduralEnabled: true,
  riskConfig: { rules: { sources: [] } }
};

const result = computeInterproceduralRisk({
  chunks: [sourceChunk],
  summaries: rows,
  runtime
});

assert.equal(result.status, 'ok');
assert.equal(result.stats?.status, 'ok');
assert.equal(result.stats?.reason, null);
assert.equal(result.stats?.effectiveConfig?.summaryOnly, true);

console.log('risk interprocedural summary-only status test passed');
