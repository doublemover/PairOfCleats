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
        startLine: 5,
        startCol: 1,
        endLine: 5,
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
      maxTotalFlows: 0,
      maxCallSitesPerEdge: 2,
      maxEdgeExpansions: 100,
      maxMs: null
    }
  },
  riskInterproceduralEnabled: true,
  riskConfig: { rules: { sources: [] } }
};

const result = computeInterproceduralRisk({
  chunks: [sourceChunk, sinkChunk],
  summaries: rows,
  runtime
});

assert.equal(result.status, 'ok');
assert.equal(result.flowRows.length, 0, 'maxTotalFlows=0 should emit zero flows');
assert.ok(
  Array.isArray(result.stats?.capsHit) && result.stats.capsHit.includes('maxTotalFlows'),
  'stats.capsHit should include maxTotalFlows'
);

console.log('risk interprocedural maxTotalFlows cap test passed');
