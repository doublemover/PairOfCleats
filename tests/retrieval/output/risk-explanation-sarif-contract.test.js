#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildRiskExplanationModelFromRiskSlice,
  buildRiskExplanationModelFromStandalone
} from '../../../src/retrieval/output/risk-explain.js';
import { renderRiskExplanationSarif } from '../../../src/retrieval/output/risk-sarif.js';

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

const minimalSarif = renderRiskExplanationSarif(minimalModel, { title: 'Risk Explain', maxFlows: 1, maxEvidencePerFlow: 2 });
assert.equal(minimalSarif.version, '2.1.0');
assert.equal(minimalSarif.runs[0].results.length, 0);
assert.deepEqual(minimalSarif.runs[0].properties.pairOfCleats.flowSelection, {
  totalFlows: 0,
  shownFlows: 0,
  omittedFlows: 0,
  maxFlows: 1,
  maxEvidencePerFlow: 2
});
assert.deepEqual(minimalSarif.runs[0].properties.pairOfCleats.partialFlowSelection, {
  totalPartialFlows: 0,
  shownPartialFlows: 0,
  omittedPartialFlows: 0,
  maxPartialFlows: 3,
  maxEvidencePerFlow: 2
});

const fullModel = buildRiskExplanationModelFromStandalone({
  chunk: {
    chunkUid: 'chunk-full',
    file: 'src/full.js',
    name: 'full',
    kind: 'function'
  },
  provenance: {
    generatedAt: '2026-03-12T00:00:00.000Z',
    ruleBundle: { version: '1.0.0', fingerprint: 'sha1:bundle' },
    effectiveConfigFingerprint: 'sha1:config'
  },
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
        nodes: [
          { type: 'chunk', chunkUid: 'chunk-full' },
          { type: 'chunk', chunkUid: 'chunk-mid' }
        ],
        callSiteIdsByStep: [['cs-1']]
      },
      notes: {
        terminalReason: 'maxDepth',
        hopCount: 1,
        capsHit: ['maxDepth']
      }
    }
  ],
  flows: [
    {
      flowId: 'flow-full',
      confidence: 0.91,
      category: 'injection',
      source: { ruleId: 'SRC' },
      sink: { ruleId: 'SNK', severity: 'high' },
      path: {
        nodes: [
          { type: 'chunk', chunkUid: 'chunk-full' },
          { type: 'chunk', chunkUid: 'chunk-sink' }
        ],
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
  ]
});

const fullSarif = renderRiskExplanationSarif(fullModel, { title: 'Risk Explain', maxFlows: 3, maxEvidencePerFlow: 2 });
assert.equal(fullSarif.runs[0].results.length, 1);
assert.equal(fullSarif.runs[0].tool.driver.rules.length, 1);
assert.equal(fullSarif.runs[0].results[0].ruleId, 'pairofcleats/risk-flow');
assert.equal(fullSarif.runs[0].results[0].properties.pairOfCleats.flowId, 'flow-full');
assert.equal(fullSarif.runs[0].results[0].properties.pairOfCleats.confidence, 0.91);
assert.equal(fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.artifactLocation.uri, 'src/full.js');
assert.equal(fullSarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.region.startLine, 18);
assert.match(fullSarif.runs[0].results[0].message.text, /injection \| SRC -> SNK/);
assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlowSelection.totalPartialFlows, 1);
assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].partialFlowId, 'partial-a');
assert.equal(fullSarif.runs[0].properties.pairOfCleats.partialFlows[0].frontier.chunkUid, 'chunk-mid');

const cappedModel = buildRiskExplanationModelFromRiskSlice({
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

const cappedSarif = renderRiskExplanationSarif(cappedModel, { title: 'Risk Explain', maxFlows: 1, maxEvidencePerFlow: 1 });
assert.equal(cappedSarif.runs[0].results.length, 1);
assert.deepEqual(cappedSarif.runs[0].properties.pairOfCleats.flowSelection, {
  totalFlows: 2,
  shownFlows: 1,
  omittedFlows: 1,
  maxFlows: 1,
  maxEvidencePerFlow: 1
});
assert.deepEqual(cappedSarif.runs[0].properties.pairOfCleats.truncation, cappedModel.truncation);

console.log('risk explanation sarif contract test passed');
