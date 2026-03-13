#!/usr/bin/env node
import assert from 'node:assert/strict';

import { renderCompositeContextPackJson } from '../../../src/retrieval/output/composite-context-pack.js';

const payload = {
  primary: {
    ref: { type: 'chunk', chunkUid: 'chunk-risk' },
    file: 'src/app.ts',
    excerpt: 'query(req.body);'
  },
  risk: {
    status: 'ok',
    summary: {
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 1
      },
      topCategories: [{ category: 'injection', count: 1 }],
      topTags: []
    },
    provenance: {
      generatedAt: '2026-03-12T00:00:00.000Z',
      ruleBundle: { version: '1.0.0', fingerprint: 'sha1:bundle' },
      effectiveConfigFingerprint: 'sha1:config'
    },
    flows: [
      {
        flowId: 'flow-a',
        confidence: 0.95,
        category: 'injection',
        source: { ruleId: 'SRC' },
        sink: { ruleId: 'SNK' },
        path: {
          nodes: [
            { type: 'chunk', chunkUid: 'chunk-risk' },
            { type: 'chunk', chunkUid: 'chunk-sink' }
          ],
          watchByStep: [{
            taintIn: ['req.body'],
            taintOut: ['input'],
            propagatedArgIndices: [0],
            boundParams: ['input'],
            calleeNormalized: 'query',
            semanticIds: ['sem.callback.register-handler-payload'],
            semanticKinds: ['callback'],
            sanitizerPolicy: 'terminate',
            sanitizerBarrierApplied: false,
            sanitizerBarriersBefore: 0,
            sanitizerBarriersAfter: 0,
            confidenceBefore: 0.6,
            confidenceAfter: 0.51,
            confidenceDelta: -0.09
          }]
        },
        evidence: {
          callSitesByStep: [[{
            callSiteId: 'cs-1',
            details: {
              file: 'src/app.ts',
              startLine: 14,
              startCol: 3,
              calleeNormalized: 'query',
              args: ['req.body']
            }
          }]]
        }
      }
    ],
    partialFlows: [
      {
        partialFlowId: 'partial-a',
        confidence: 0.61,
        source: { ruleId: 'SRC', chunkUid: 'chunk-risk' },
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
            { type: 'chunk', chunkUid: 'chunk-risk' },
            { type: 'chunk', chunkUid: 'chunk-mid' }
          ],
          watchByStep: [{
            taintIn: ['req.body'],
            taintOut: ['input'],
            propagatedArgIndices: [0],
            boundParams: ['input'],
            calleeNormalized: 'query',
            semanticIds: ['sem.callback.register-handler-payload'],
            semanticKinds: ['callback'],
            sanitizerPolicy: 'terminate',
            sanitizerBarrierApplied: false,
            sanitizerBarriersBefore: 0,
            sanitizerBarriersAfter: 0,
            confidenceBefore: 0.6,
            confidenceAfter: 0.51,
            confidenceDelta: -0.09
          }]
        },
        notes: {
          terminalReason: 'maxDepth',
          hopCount: 1,
          capsHit: ['maxDepth']
        }
      }
    ],
    truncation: [{ cap: 'maxFlows', limit: 5, observed: 6, omitted: 1 }],
    analysisStatus: {
      status: 'ok',
      code: 'ok',
      degradedReasons: []
    }
  },
  truncation: [{ cap: 'maxBytes', limit: 2048, observed: 4096, omitted: 2048 }],
  warnings: [{ code: 'PACK_WARN', message: 'warning emitted' }]
};

const jsonPayload = renderCompositeContextPackJson(payload);
assert.ok(jsonPayload.rendered.sarif, 'expected sarif export');
assert.equal(jsonPayload.rendered.sarif.runs[0].results.length, 1);
assert.equal(
  jsonPayload.rendered.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0]
    .location.physicalLocation.artifactLocation.uri,
  'src/app.ts'
);
assert.deepEqual(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.provenance, payload.risk.provenance);
assert.equal(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.packProvenance, null);
assert.deepEqual(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.packTruncation, payload.truncation);
assert.equal(jsonPayload.rendered.sarif.runs[0].results[0].properties.pairOfCleats.flowId, 'flow-a');
assert.equal(jsonPayload.rendered.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.calleeNormalized, 'query');
assert.deepEqual(
  jsonPayload.rendered.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.semanticIds,
  ['sem.callback.register-handler-payload']
);
assert.deepEqual(
  jsonPayload.rendered.sarif.runs[0].results[0].codeFlows[0].threadFlows[0].locations[0].properties.pairOfCleats.watchWindow.semanticKinds,
  ['callback']
);
assert.equal(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.partialFlowSelection.totalPartialFlows, 1);
assert.equal(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.partialFlows[0].partialFlowId, 'partial-a');
assert.equal(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.partialFlows[0].path.watchByStep[0].calleeNormalized, 'query');
assert.deepEqual(
  jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.partialFlows[0].path.watchByStep[0].semanticIds,
  ['sem.callback.register-handler-payload']
);
assert.deepEqual(
  jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.partialFlows[0].path.watchByStep[0].semanticKinds,
  ['callback']
);

console.log('composite context pack sarif contract test passed');
