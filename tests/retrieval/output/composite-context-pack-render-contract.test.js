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
          ]
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
assert.match(markdown, /Truncation\n- maxBytes limit=2048 observed=4096 omitted=2048/);
assert.match(markdown, /Warnings\n- PACK_WARN: warning emitted/);

const jsonPayload = renderCompositeContextPackJson(payload);
assert.deepEqual(jsonPayload.rendered.truncation, payload.truncation);
assert.deepEqual(jsonPayload.rendered.warnings, payload.warnings);
assert.equal(jsonPayload.rendered.risk.flowSelection.totalFlows, 1);
assert.equal(jsonPayload.rendered.risk.flows[0].flowId, 'flow-a');
assert.equal(jsonPayload.rendered.risk.filters.sourceRule[0], 'SRC');

console.log('composite context pack render contract test passed');
