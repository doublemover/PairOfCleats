#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';

applyTestEnv();

const createChunks = (frameworkId = 'express') => ([
  {
    file: 'src/source.js',
    chunkUid: 'uid-source',
    name: 'source',
    kind: 'Function',
    startLine: 1,
    lang: 'javascript',
    docmeta: {
      frameworkProfile: { id: frameworkId },
      risk: {
        sources: [{
          id: 'source.req.body',
          name: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: 'low',
          confidence: 0.6,
          tags: ['input'],
          evidence: { line: 1, column: 1, excerpt: 'req.body' }
        }],
        sinks: [],
        sanitizers: [],
        flows: [],
        taintHints: {
          taintedIdentifiers: ['req.body']
        }
      }
    },
    codeRelations: {
      callDetails: [{
        callee: 'registerHandler',
        calleeRaw: 'registerHandler',
        calleeNormalized: 'registerHandler',
        startLine: 3,
        startCol: 1,
        endLine: 3,
        endCol: 18,
        args: ['handler', 'req.body'],
        targetChunkUid: 'uid-wrapper'
      }]
    }
  },
  {
    file: 'src/wrapper.js',
    chunkUid: 'uid-wrapper',
    name: 'registerHandler',
    kind: 'Function',
    startLine: 1,
    lang: 'javascript',
    docmeta: {
      frameworkProfile: { id: frameworkId },
      risk: {
        sources: [],
        sinks: [],
        sanitizers: [],
        flows: []
      }
    },
    codeRelations: {
      callDetails: [{
        callee: 'query',
        calleeRaw: 'query',
        calleeNormalized: 'query',
        startLine: 4,
        startCol: 1,
        endLine: 4,
        endCol: 8,
        args: ['payload'],
        targetChunkUid: 'uid-sink'
      }]
    }
  },
  {
    file: 'src/sink.js',
    chunkUid: 'uid-sink',
    name: 'query',
    kind: 'Function',
    startLine: 1,
    lang: 'javascript',
    docmeta: {
      frameworkProfile: { id: frameworkId },
      risk: {
        sources: [],
        sinks: [{
          id: 'sink.sql.query',
          name: 'sql.query',
          ruleType: 'sink',
          category: 'sql',
          severity: 'high',
          confidence: 0.8,
          tags: ['sql'],
          evidence: { line: 1, column: 1, excerpt: 'query' }
        }],
        sanitizers: [],
        flows: []
      }
    }
  }
]);

const createRuntime = (semantics = []) => ({
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'argAware',
    sanitizerPolicy: 'terminate',
    emitArtifacts: 'jsonl',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 3,
      maxTotalFlows: 100,
      maxPartialFlows: 10,
      maxCallSitesPerEdge: 3,
      maxBlockedExpansionsPerPartial: 4,
      maxEdgeExpansions: 100,
      maxMs: null
    },
    semantics
  },
  riskInterproceduralEnabled: true,
  riskConfig: {
    rules: {
      sources: []
    }
  }
});

const runScenario = ({ semantics = [], frameworkId = 'express' } = {}) => {
  const chunks = createChunks(frameworkId);
  const runtime = createRuntime(semantics);
  const { rows } = buildRiskSummaries({
    chunks,
    runtime,
    mode: 'code'
  });
  return computeInterproceduralRisk({
    chunks,
    summaries: rows,
    runtime
  });
};

const noSemantics = runScenario();
assert.equal(noSemantics.flowRows.length, 0, 'expected no interprocedural flow without framework semantics');
assert.equal(noSemantics.partialFlowRows.length, 1, 'expected a retained partial flow without semantics');

const semantics = [{
  id: 'sem.callback.register-handler-payload',
  kind: 'callback',
  name: 'register handler payload handoff',
  frameworks: ['express'],
  languages: ['javascript'],
  patterns: ['\\bregisterHandler\\b'],
  fromArgs: [1],
  taintHints: ['payload']
}];
const withSemantics = runScenario({ semantics });
assert.equal(withSemantics.flowRows.length, 1, 'expected framework semantics to recover the interprocedural flow');
assert.equal(
  withSemantics.partialFlowRows.length,
  1,
  'expected the engine to retain the terminal no-callees frontier even when semantics recover a full flow'
);
assert.deepEqual(
  withSemantics.flowRows[0]?.path?.watchByStep?.[0]?.semanticIds,
  ['sem.callback.register-handler-payload'],
  'expected applied semantics id on watch window'
);
assert.deepEqual(
  withSemantics.flowRows[0]?.path?.watchByStep?.[0]?.semanticKinds,
  ['callback'],
  'expected applied semantics kind on watch window'
);
assert.deepEqual(
  withSemantics.flowRows[0]?.path?.watchByStep?.[0]?.taintOut,
  ['payload'],
  'expected semantics taint hint to drive the next step'
);
assert.deepEqual(
  withSemantics.partialFlowRows[0]?.path?.watchByStep?.[0]?.semanticIds,
  ['sem.callback.register-handler-payload'],
  'expected retained partial frontier to preserve semantics metadata'
);
assert.equal(
  withSemantics.partialFlowRows[0]?.notes?.terminalReason,
  'noCallees',
  'expected the retained partial frontier to reflect terminal no-callees behavior'
);

const wrongFramework = runScenario({
  semantics: [{ ...semantics[0], frameworks: ['next'] }]
});
assert.equal(wrongFramework.flowRows.length, 0, 'expected framework-scoped semantics not to apply outside their framework');

console.log('risk interprocedural framework semantics test passed');
