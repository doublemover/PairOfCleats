#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  renderCompositeContextPack,
  renderCompositeContextPackJson
} from '../../../src/retrieval/output/composite-context-pack.js';

const payload = {
  primary: {
    ref: { type: 'chunk', chunkUid: 'chunk-risk' },
    file: 'src/app.ts',
    excerpt: 'query(req.body);',
    provenance: {
      excerptSource: 'repo-range',
      excerptHash: 'sha1:excerpt',
      excerptBytes: 16
    }
  },
  risk: {
    status: 'ok',
    filters: {
      rule: [],
      category: [],
      severity: [],
      tag: [],
      source: [],
      sink: [],
      sourceRule: ['SRC'],
      sinkRule: ['SNK'],
      flowId: []
    },
    summary: {
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 1
      },
      ruleRoles: {
        sources: 1,
        sinks: 1,
        sanitizers: 0
      },
      propagatorLikeRoles: [{ role: 'callback', count: 1 }],
      topCategories: [{ category: 'injection', count: 1 }],
      topTags: []
    },
    provenance: {
      generatedAt: '2026-03-12T00:00:00.000Z',
      ruleBundle: {
        version: '1.0.0',
        fingerprint: 'sha1:bundle',
        roleModel: {
          version: '1.0.0',
          directRoles: ['source', 'sink', 'sanitizer'],
          propagatorLikeRoles: ['propagator', 'wrapper', 'builder', 'callback', 'asyncHandoff'],
          propagatorLikeEncoding: 'watch-semantics'
        }
      },
      effectiveConfigFingerprint: 'sha1:config'
    },
    flows: [
      {
        flowId: 'flow-a',
        confidence: 0.95,
        category: 'injection',
        source: { ruleId: 'SRC', ruleRole: 'source', tags: ['input', 'http'] },
        sink: { ruleId: 'SNK', ruleRole: 'sink', tags: ['sql'] },
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
    partialFlows: Array.from({ length: 5 }, (_, index) => ({
      partialFlowId: `partial-${String.fromCharCode(97 + index)}`,
      confidence: 0.61 + (index * 0.01),
      source: { ruleId: 'SRC', chunkUid: 'chunk-risk' },
      frontier: {
        chunkUid: index === 4 ? 'chunk-tail' : 'chunk-mid',
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
          { type: 'chunk', chunkUid: index === 4 ? 'chunk-tail' : 'chunk-mid' }
        ],
        callSiteIdsByStep: [['cs-1']],
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
      },
      notes: {
        terminalReason: 'maxDepth',
        hopCount: 1,
        capsHit: ['maxDepth']
      }
    })),
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

const markdown = renderCompositeContextPack(payload);
assert.match(markdown, /Primary/);
assert.match(markdown, /Provenance: source=repo-range, hash=sha1:excerpt, bytes=16/);
assert.match(markdown, /Risk/);
assert.match(markdown, /summary: sources 1, sinks 1, sanitizers 0, localFlows 1/);
assert.match(markdown, /Partial Risk Flows/);
assert.match(markdown, /partial-e/);
assert.match(markdown, /Truncation\n- maxBytes limit=2048 observed=4096 omitted=2048/);
assert.match(markdown, /Warnings\n- PACK_WARN: warning emitted/);

const jsonPayload = renderCompositeContextPackJson(payload);
assert.deepEqual(jsonPayload.rendered.truncation, payload.truncation);
assert.deepEqual(jsonPayload.rendered.warnings, payload.warnings);
assert.equal(jsonPayload.rendered.risk.subject.chunkUid, 'chunk-risk');
assert.equal(jsonPayload.rendered.risk.subject.file, 'src/app.ts');
assert.deepEqual(jsonPayload.rendered.risk.summary.ruleRoles, { sources: 1, sinks: 1, sanitizers: 0 });
assert.deepEqual(jsonPayload.rendered.risk.summary.propagatorLikeRoles, [{ role: 'callback', count: 1 }]);
assert.equal(jsonPayload.rendered.risk.flowSelection.totalFlows, 1);
assert.equal(jsonPayload.rendered.risk.flows[0].flowId, 'flow-a');
assert.equal(jsonPayload.rendered.risk.flows[0].source.ruleRole, 'source');
assert.deepEqual(jsonPayload.rendered.risk.flows[0].source.tags, ['input', 'http']);
assert.equal(jsonPayload.rendered.risk.flows[0].sink.ruleRole, 'sink');
assert.deepEqual(jsonPayload.rendered.risk.flows[0].sink.tags, ['sql']);
assert.equal(jsonPayload.rendered.risk.flows[0].steps[0].watchWindow.calleeNormalized, 'query');
assert.deepEqual(jsonPayload.rendered.risk.flows[0].steps[0].watchWindow.semanticIds, ['sem.callback.register-handler-payload']);
assert.deepEqual(jsonPayload.rendered.risk.flows[0].steps[0].watchWindow.semanticKinds, ['callback']);
assert.equal(jsonPayload.rendered.risk.partialFlowSelection.totalPartialFlows, 5);
assert.equal(jsonPayload.rendered.risk.partialFlowSelection.shownPartialFlows, 5);
assert.equal(jsonPayload.rendered.risk.partialFlowSelection.maxPartialFlows, 5);
assert.equal(jsonPayload.rendered.risk.partialFlows.length, 5);
assert.equal(jsonPayload.rendered.risk.partialFlows[4].partialFlowId, 'partial-e');
assert.equal(jsonPayload.rendered.risk.partialFlows[0].steps[0].watchWindow.calleeNormalized, 'query');
assert.deepEqual(jsonPayload.rendered.risk.partialFlows[0].steps[0].watchWindow.semanticIds, ['sem.callback.register-handler-payload']);
assert.deepEqual(jsonPayload.rendered.risk.partialFlows[0].steps[0].watchWindow.semanticKinds, ['callback']);
assert.equal(jsonPayload.rendered.risk.filters.sourceRule[0], 'SRC');
assert.equal(jsonPayload.rendered.sarif.runs[0].automationDetails.id, 'context-pack');
assert.equal(jsonPayload.rendered.risk.provenance.ruleBundle.roleModel.propagatorLikeEncoding, 'watch-semantics');
assert.equal(jsonPayload.rendered.sarif.runs[0].properties.pairOfCleats.packWarnings[0].code, 'PACK_WARN');
assert.equal(jsonPayload.rendered.sarif.runs[0].results[0].partialFingerprints.pairOfCleatsFlowId, 'flow-a');

console.log('composite context pack render contract test passed');
