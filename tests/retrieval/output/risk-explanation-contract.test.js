#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone,
  renderRiskExplanation,
  renderRiskExplanationJson
} from '../../../src/retrieval/output/risk-explain.js';

const minimalModel = buildRiskExplanationModelFromStandalone({
  chunk: {
    chunkUid: 'chunk-min',
    file: 'src/min.js',
    name: 'minimal',
    kind: 'function'
  },
  summary: {
    totals: {
      sources: 0,
      sinks: 0,
      sanitizers: 0,
      localFlows: 0
    },
    topCategories: [],
    topTags: []
  },
  stats: {
    status: 'ok',
    flowsEmitted: 0,
    summariesEmitted: 1,
    uniqueCallSitesReferenced: 0,
    capsHit: []
  },
  flows: []
});

const minimalJson = renderRiskExplanationJson(minimalModel, { title: 'Risk Explain', maxFlows: 1, maxEvidencePerFlow: 2 });
assert.deepEqual(minimalJson.flowSelection, {
  totalFlows: 0,
  shownFlows: 0,
  omittedFlows: 0,
  maxFlows: 1,
  maxEvidencePerFlow: 2
});
assert.deepEqual(minimalJson.partialFlowSelection, {
  totalPartialFlows: 0,
  shownPartialFlows: 0,
  omittedPartialFlows: 0,
  maxPartialFlows: 3,
  maxEvidencePerFlow: 2
});
assert.deepEqual(minimalJson.flows, []);
assert.deepEqual(minimalJson.partialFlows, []);
assert.equal(minimalJson.summary?.totals?.sources, 0);
assert.match(renderRiskExplanation(minimalModel, { maxFlows: 1, maxEvidencePerFlow: 2 }), /Risk Flows\n- \(none\)/);

const fullModel = buildRiskExplanationModelFromRiskSlice({
  summary: {
    totals: {
      sources: 1,
      sinks: 1,
      sanitizers: 0,
      localFlows: 1
    },
    topCategories: [{ category: 'injection', count: 1 }],
    topTags: [{ tag: 'sql', count: 1 }]
  },
  stats: {
    status: 'ok',
    flowsEmitted: 1,
    partialFlowsEmitted: 2,
    summariesEmitted: 1,
    uniqueCallSitesReferenced: 1,
    capsHit: []
  },
  analysisStatus: {
    status: 'ok',
    code: 'ok'
  },
  caps: {
    maxFlows: 3,
    maxPartialFlows: 5,
    maxBytes: 512,
    maxTokens: 128,
    maxPartialBytes: 100,
    maxPartialTokens: 50,
    hits: []
  },
  provenance: {
    generatedAt: '2026-03-12T00:00:00.000Z',
    ruleBundle: { version: '1.0.0', fingerprint: 'sha1:bundle' },
    effectiveConfigFingerprint: 'sha1:config'
  },
  flows: [
    {
      flowId: 'flow-full',
      confidence: 0.91,
      category: 'injection',
      source: { ruleId: 'SRC' },
      sink: { ruleId: 'SNK' },
      path: {
        labels: ['chunk:src', 'chunk:sink'],
        callSiteIdsByStep: [['cs-1']]
      },
      evidence: {
        callSitesByStep: [[{
          callSiteId: 'cs-1',
          details: {
            file: 'src/full.js',
            startLine: 18,
            startCol: 4,
            calleeNormalized: 'query',
            args: ['req.body'],
            excerpt: 'query(req.body)'
          }
        }]]
      }
    }
  ],
  partialFlows: [
    {
      partialFlowId: 'partial-a',
      confidence: 0.72,
      source: { ruleId: 'SRC', chunkUid: 'chunk-full' },
      frontier: {
        chunkUid: 'chunk-mid',
        terminalReason: 'maxDepth',
        blockedExpansions: [
          {
            reason: 'maxEdgeExpansions',
            targetChunkUid: 'chunk-sink',
            callSiteIds: ['cs-1']
          }
        ]
      },
      path: {
        labels: ['chunk:src', 'chunk:mid'],
        callSiteIdsByStep: [['cs-1']]
      },
      evidence: {
        callSitesByStep: [[{
          callSiteId: 'cs-1',
          details: {
            file: 'src/full.js',
            startLine: 18,
            startCol: 4,
            calleeNormalized: 'query',
            args: ['req.body'],
            excerpt: 'query(req.body)'
          }
        }]]
      },
      notes: {
        hopCount: 1,
        terminalReason: 'maxDepth',
        capsHit: ['maxDepth']
      }
    }
  ]
}, {
  subject: {
    chunkUid: 'chunk-full',
    file: 'src/full.js',
    name: 'full',
    kind: 'function'
  }
});

const fullJson = renderRiskExplanationJson(fullModel, {
  title: 'Risk Explain',
  maxFlows: 3,
  maxPartialFlows: 5,
  maxEvidencePerFlow: 2
});
assert.equal(fullJson.flows[0].flowId, 'flow-full');
assert.equal(fullJson.flows[0].steps[0].step, 1);
assert.deepEqual(fullJson.flows[0].steps[0].evidence, ['src/full.js:18:4 query(req.body)']);
assert.equal(fullJson.sarif.runs[0].results[0].partialFingerprints.pairOfCleatsFlowId, 'flow-full');
assert.equal(fullJson.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.artifactLocation.uri, 'src/full.js');
assert.equal(fullJson.partialFlowSelection.totalPartialFlows, 1);
assert.equal(fullJson.partialFlows[0].partialFlowId, 'partial-a');
assert.equal(fullJson.partialFlows[0].terminalReason, 'maxDepth');
assert.equal(fullJson.partialFlows[0].frontierChunkUid, 'chunk-mid');
assert.deepEqual(fullJson.partialFlows[0].steps[0].evidence, ['src/full.js:18:4 query(req.body)']);
const fullMarkdown = renderRiskExplanation(fullModel, {
  maxFlows: 3,
  maxPartialFlows: 5,
  maxEvidencePerFlow: 2
});
assert.match(fullMarkdown, /summary: sources 1, sinks 1, sanitizers 0, localFlows 1/);
assert.match(fullMarkdown, /interprocedural: status ok, flows 1, partial flows 2, summaries 1, call sites 1/);
assert.match(fullMarkdown, /pack caps: maxFlows 3, maxPartialFlows 5, maxBytes 512, maxTokens 128, maxPartialBytes 100, maxPartialTokens 50/);
assert.match(fullMarkdown, /provenance: generated 2026-03-12T00:00:00.000Z, rules 1.0.0 sha1:bundle, config sha1:config/);
assert.match(fullMarkdown, /step 1: src\/full.js:18:4 query\(req.body\)/);
assert.match(fullMarkdown, /Partial Risk Flows/);
assert.match(fullMarkdown, /partial-a/);

const cappedModel = buildRiskExplanationModelFromRiskSlice({
  summary: {
    totals: {
      sources: 2,
      sinks: 2,
      sanitizers: 0,
      localFlows: 2
    },
    topCategories: [{ category: 'injection', count: 2 }],
    topTags: []
  },
  truncation: [{ cap: 'maxFlows', limit: 1, observed: 2, omitted: 1 }],
  flows: [
    {
      flowId: 'flow-a',
      confidence: 0.7,
      category: 'injection',
      source: { ruleId: 'SRC-A' },
      sink: { ruleId: 'SNK-A' },
      path: { labels: ['chunk:a', 'chunk:b'] },
      evidence: { callSitesByStep: [[{ callSiteId: 'cs-a' }]] }
    },
    {
      flowId: 'flow-b',
      confidence: 0.6,
      category: 'injection',
      source: { ruleId: 'SRC-B' },
      sink: { ruleId: 'SNK-B' },
      path: { labels: ['chunk:b', 'chunk:c'] },
      evidence: { callSitesByStep: [[{ callSiteId: 'cs-b' }]] }
    }
  ]
});

const cappedJson = renderRiskExplanationJson(cappedModel, { title: 'Risk Explain', maxFlows: 1, maxEvidencePerFlow: 1 });
assert.deepEqual(cappedJson.flowSelection, {
  totalFlows: 2,
  shownFlows: 1,
  omittedFlows: 1,
  maxFlows: 1,
  maxEvidencePerFlow: 1
});
assert.equal(cappedJson.flows.length, 1);
assert.equal(cappedJson.sarif.runs[0].properties.pairOfCleats.flowSelection.omittedFlows, 1);
const cappedMarkdown = renderRiskExplanation(cappedModel, { maxFlows: 1, maxEvidencePerFlow: 1 });
assert.match(cappedMarkdown, /truncation: maxFlows/);
assert.match(cappedMarkdown, /omitted 1 additional flow\(s\) after maxFlows=1/);

console.log('risk explanation render contract test passed');
