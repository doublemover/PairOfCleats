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
  },
  codeRelations: {
    callDetails: [
      {
        callee: 'sanitize',
        calleeRaw: 'sanitize',
        calleeNormalized: 'sanitize',
        startLine: 3,
        startCol: 1,
        endLine: 3,
        endCol: 10,
        args: ['req.body'],
        targetChunkUid: 'uid-sanitize'
      }
    ]
  }
};

const sanitizerChunk = {
  file: 'src/sanitize.js',
  chunkUid: 'uid-sanitize',
  name: 'sanitize',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [],
      sinks: [],
      sanitizers: [
        {
          id: 'sanitize.escape',
          name: 'escape',
          ruleType: 'sanitizer',
          category: 'sanitize',
          severity: null,
          confidence: 0.4,
          tags: ['sanitize'],
          evidence: { line: 2, column: 1, excerpt: 'escape' }
        }
      ],
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
        endCol: 8,
        args: ['value'],
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

const baseRuntime = {
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'conservative',
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

const { rows } = buildRiskSummaries({
  chunks: [sourceChunk, sanitizerChunk, sinkChunk],
  runtime: baseRuntime,
  mode: 'code'
});

const terminateResult = computeInterproceduralRisk({
  chunks: [sourceChunk, sanitizerChunk, sinkChunk],
  summaries: rows,
  runtime: { ...baseRuntime, riskInterproceduralConfig: { ...baseRuntime.riskInterproceduralConfig, sanitizerPolicy: 'terminate' } }
});
assert.equal(terminateResult.flowRows.length, 0, 'terminate should stop propagation past sanitizer');

const weakenResult = computeInterproceduralRisk({
  chunks: [sourceChunk, sanitizerChunk, sinkChunk],
  summaries: rows,
  runtime: { ...baseRuntime, riskInterproceduralConfig: { ...baseRuntime.riskInterproceduralConfig, sanitizerPolicy: 'weaken' } }
});
assert.equal(weakenResult.flowRows.length, 1, 'weaken should allow propagation');
assert.equal(weakenResult.flowRows[0].notes.sanitizerBarriersHit, 1, 'should record sanitizer barrier');

console.log('risk interprocedural sanitizer policy test passed');
