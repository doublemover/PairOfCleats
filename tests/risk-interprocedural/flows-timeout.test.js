#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../src/index/risk-interprocedural/engine.js';

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
  },
  codeRelations: {
    callDetails: [
      {
        callee: 'sink',
        calleeRaw: 'sink',
        calleeNormalized: 'sink',
        startLine: 3,
        startCol: 1,
        endLine: 3,
        endCol: 10,
        args: ['req.body'],
        targetChunkUid: 'uid-sink'
      }
    ]
  }
};

const sinkChunk = {
  file: 'src/sink.js',
  chunkUid: 'uid-sink',
  name: 'sink',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [],
      sinks: [
        {
          id: 'sink.eval',
          name: 'eval',
          ruleType: 'sink',
          category: 'code-exec',
          severity: 'high',
          confidence: 0.8,
          tags: ['exec'],
          evidence: { line: 2, column: 1, excerpt: 'eval' }
        }
      ],
      sanitizers: [],
      flows: []
    }
  }
};

const { rows } = buildRiskSummaries({
  chunks: [sourceChunk, sinkChunk],
  interprocedural: { enabled: true, summaryOnly: false }
});

const runtime = {
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    emitArtifacts: 'jsonl',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 3,
      maxTotalFlows: 100,
      maxCallSitesPerEdge: 2,
      maxEdgeExpansions: 100,
      maxMs: 10
    }
  },
  riskInterproceduralEnabled: true,
  riskConfig: { rules: { sources: [] } }
};

const originalNow = Date.now;
let tick = 0;
Date.now = () => {
  tick += 20;
  return tick;
};
const result = computeInterproceduralRisk({
  chunks: [sourceChunk, sinkChunk],
  summaries: rows,
  runtime
});
Date.now = originalNow;

assert.equal(result.status, 'timed_out');
assert.equal(result.flowRows.length, 0, 'timeout should emit no flows');

console.log('risk interprocedural timeout test passed');
