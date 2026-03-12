#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildRiskExplanationModelFromStandalone,
  renderCompositeContextPack,
  renderRiskExplanation
} = require('../../../extensions/vscode/analysis-renderers.js');

const rendered = renderCompositeContextPack({
  primary: {
    ref: { type: 'chunk', chunkUid: 'chunk-risk' },
    file: 'src/app.ts',
    excerpt: 'export function risky(input) { return query(input); }'
  },
  risk: {
    status: 'ok',
    summary: {
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 0
      }
    },
    provenance: {
      generatedAt: '2026-03-12T00:00:00.000Z',
      ruleBundle: {
        version: '1.0.0',
        fingerprint: 'sha1:rulebundle-risk-assembly'
      },
      effectiveConfigFingerprint: 'sha1:config-risk-assembly',
      artifactRefs: {
        stats: {
          entrypoint: 'risk_interprocedural_stats.json'
        },
        flows: {
          entrypoint: 'risk_flows.jsonl'
        }
      }
    },
    flows: []
  }
});

assert.match(rendered, /rules 1\.0\.0 sha1:rulebundle-risk-assembly/, 'expected rendered rule bundle provenance');
assert.match(rendered, /config sha1:config-risk-assembly/, 'expected rendered config fingerprint');
assert.match(rendered, /artifact refs: stats=risk_interprocedural_stats\.json, flows=risk_flows\.jsonl/, 'expected rendered artifact refs');

console.log('vscode context risk renderer test passed');


const standaloneRendered = renderRiskExplanation(
  buildRiskExplanationModelFromStandalone({
    chunk: {
      chunkUid: 'chunk-risk',
      file: 'src/app.ts',
      name: 'risky',
      kind: 'function'
    },
    summary: {
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 0
      },
      topCategories: [
        { category: 'input', count: 1 }
      ]
    },
    stats: {
      status: 'ok',
      flowsEmitted: 1
    },
    provenance: {
      generatedAt: '2026-03-12T00:00:00.000Z'
    },
    flows: []
  }),
  {
    title: null,
    includeSubject: false,
    includeFilters: false
  }
);

assert.match(standaloneRendered, /summary: sources 1, sinks 1, sanitizers 0, localFlows 0/, 'expected shared summary rendering');
assert.match(standaloneRendered, /interprocedural: status ok, flows 1/, 'expected shared interprocedural rendering');
