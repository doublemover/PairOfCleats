#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone,
  renderRiskExplanation
} from '../../../src/retrieval/output/risk-explain.js';

const flows = [
  {
    flowId: 'flow-1',
    confidence: 0.88,
    category: 'injection',
    source: { chunkUid: 'chunk-a', ruleId: 'SRC1', category: 'input' },
    sink: { chunkUid: 'chunk-b', ruleId: 'SNK1', category: 'injection' },
    path: {
      nodes: [
        { type: 'chunk', chunkUid: 'chunk-a' },
        { type: 'chunk', chunkUid: 'chunk-b' }
      ],
      callSiteIdsByStep: [['cs-1', 'cs-2']]
    },
    evidence: {
      callSitesByStep: [[
        { callSiteId: 'cs-1', details: { file: 'src/app.ts' } },
        { callSiteId: 'cs-2', details: { file: 'src/app.ts' } }
      ]]
    }
  }
];

const summary = {
  chunkUid: 'chunk-a',
  file: 'src/app.ts',
  totals: {
    sources: 1,
    sinks: 1,
    sanitizers: 0,
    localFlows: 0
  },
  topCategories: [
    { category: 'injection', count: 1 },
    { category: 'input', count: 1 }
  ],
  topTags: [
    { tag: 'sql', count: 2 }
  ]
};

const stats = {
  status: 'ok',
  flowsEmitted: 1,
  summariesEmitted: 1,
  uniqueCallSitesReferenced: 2,
  capsHit: []
};

const provenance = {
  generatedAt: '2026-03-12T00:00:00.000Z',
  ruleBundle: {
    version: '1.0.0',
    fingerprint: 'sha1:rules'
  },
  effectiveConfigFingerprint: 'sha1:config',
  artifactRefs: {
    flows: { entrypoint: 'risk_flows.jsonl' }
  }
};

const standalone = renderRiskExplanation(
  buildRiskExplanationModelFromStandalone({
    chunk: {
      chunkUid: 'chunk-a',
      file: 'src/app.ts',
      name: 'risky',
      kind: 'function'
    },
    summary: {
      chunkUid: 'chunk-a',
      file: 'src/app.ts',
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 0
      },
      signals: {
        sources: [{ category: 'input', tags: ['sql'] }],
        sinks: [{ category: 'injection', tags: ['sql'] }],
        sanitizers: [],
        localFlows: []
      }
    },
    stats: {
      status: 'ok',
      counts: {
        flowsEmitted: 1,
        summariesEmitted: 1,
        uniqueCallSitesReferenced: 2
      },
      capsHit: [],
      provenance
    },
    flows,
    filters: {}
  }),
  {
    title: null,
    includeSubject: false,
    includeFilters: false,
    maxFlows: 1
  }
);

const fromPack = renderRiskExplanation(
  buildRiskExplanationModelFromRiskSlice({
    summary,
    stats,
    provenance,
    analysisStatus: { status: 'ok', code: 'ok' },
    flows
  }),
  {
    title: null,
    includeSubject: false,
    includeFilters: false,
    maxFlows: 1
  }
);

assert.equal(standalone, fromPack, 'expected standalone and context-pack explanation rendering to align');
console.log('risk explain alignment test passed');
