#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';
import {
  applyCrossFileInferenceBudgetPlan,
  buildCrossFileInferenceBudgetPlan,
  buildCrossFileInferenceRoiMetrics
} from '../../../../src/index/build/indexer/steps/relations.js';

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

const { rows } = buildRiskSummaries({
  chunks: [sourceChunk],
  runtime,
  mode: 'code'
});

const result = computeInterproceduralRisk({
  chunks: [sourceChunk],
  summaries: rows,
  runtime
});

assert.equal(result.status, 'ok');
assert.equal(result.stats?.status, 'ok');
assert.equal(result.stats?.reason, null);
assert.equal(result.stats?.effectiveConfig?.summaryOnly, true);

const makeSignals = (count, prefix) => (
  Array.from({ length: count }, (_, index) => `${prefix}.${index}`)
);

const inferenceChunks = [
  {
    file: 'src/source.js',
    codeRelations: {
      calls: makeSignals(180, 'source.call'),
      callDetails: makeSignals(220, 'source.detail'),
      usages: makeSignals(260, 'source.usage')
    }
  },
  {
    file: 'src/other.js',
    codeRelations: {
      calls: makeSignals(170, 'other.call'),
      callDetails: makeSignals(210, 'other.detail'),
      usages: makeSignals(250, 'other.usage')
    }
  }
];

const fileRelations = new Map([
  ['src/source.js', { usages: makeSignals(320, 'source.fileUsage') }],
  ['src/other.js', { usages: makeSignals(300, 'other.fileUsage') }]
]);

const budgetPlan = buildCrossFileInferenceBudgetPlan({
  chunks: inferenceChunks,
  fileRelations,
  inferenceLiteEnabled: true
});
assert.equal(budgetPlan?.schemaVersion, 1);
assert.equal(budgetPlan?.inferenceLiteEnabled, true);

const budgeted = applyCrossFileInferenceBudgetPlan({
  chunks: inferenceChunks,
  fileRelations,
  plan: budgetPlan
});
const budgetStats = budgeted?.budgetStats;
assert.ok(budgetStats, 'expected budget stats payload');
assert.ok(budgetStats.dropped.callSignals > 0, 'expected call signal budget drop');
assert.ok(budgetStats.dropped.callDetailSignals > 0, 'expected call-detail budget drop');
assert.ok(budgetStats.dropped.chunkUsageSignals > 0, 'expected chunk usage budget drop');
assert.ok(budgetStats.dropped.fileUsageSignals > 0, 'expected file usage budget drop');
assert.equal(
  budgetStats.input.callSignals,
  budgetStats.retained.callSignals + budgetStats.dropped.callSignals
);
assert.equal(
  budgetStats.input.callDetailSignals,
  budgetStats.retained.callDetailSignals + budgetStats.dropped.callDetailSignals
);
assert.equal(
  budgetStats.input.chunkUsageSignals,
  budgetStats.retained.chunkUsageSignals + budgetStats.dropped.chunkUsageSignals
);
assert.equal(
  budgetStats.input.fileUsageSignals,
  budgetStats.retained.fileUsageSignals + budgetStats.dropped.fileUsageSignals
);

const roi = buildCrossFileInferenceRoiMetrics({
  crossFileStats: {
    linkedCalls: 12,
    linkedUsages: 18,
    inferredReturns: 5,
    riskFlows: 3,
    toolingProvidersExecuted: 4,
    toolingProvidersContributed: 2,
    toolingDegradedProviders: 1,
    toolingDegradedWarnings: 3,
    toolingDegradedErrors: 1,
    toolingRequests: 20,
    toolingRequestFailures: 4,
    toolingRequestTimeouts: 2
  },
  budgetStats,
  durationMs: 87
});
assert.equal(roi.linkAdditions, 30);
assert.equal(roi.contributionSignal, 8);
assert.ok(roi.retainedLinksAfterFiltering > 0, 'expected non-zero retained link count');
assert.ok(roi.linkRetentionRate > 0, 'expected non-zero retention rate');
assert.ok(roi.contributionPerAddedLink > 0, 'expected non-zero contribution per added link');
assert.equal(roi.tooling.providersExecuted, 4, 'expected tooling providersExecuted in roi metrics');
assert.equal(roi.tooling.providersContributed, 2, 'expected tooling providersContributed in roi metrics');
assert.equal(roi.tooling.degradedProviders, 1, 'expected tooling degradedProviders in roi metrics');
assert.equal(roi.tooling.requests, 20, 'expected tooling requests in roi metrics');
assert.equal(roi.tooling.requestFailures, 4, 'expected tooling requestFailures in roi metrics');
assert.equal(roi.tooling.requestTimeouts, 2, 'expected tooling requestTimeouts in roi metrics');
assert.equal(roi.tooling.requestFailureRate, 0.2, 'expected tooling request failure rate');
assert.equal(roi.tooling.requestTimeoutRate, 0.1, 'expected tooling request timeout rate');
assert.equal(roi.tooling.degradedProviderRate, 0.25, 'expected tooling degraded provider rate');

console.log('risk interprocedural summary-only status test passed');
