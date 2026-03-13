#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildRiskExplanationPresentationFromRiskSlice } from '../../../src/retrieval/output/risk-explain.js';
import { renderCompositeContextPack } from '../../../src/retrieval/output/composite-context-pack.js';
import { renderRiskExplain } from '../../../src/retrieval/output/risk-explain.js';

const callSiteDetails = {
  file: 'src/app.js',
  startLine: 27,
  startCol: 5,
  calleeNormalized: 'dangerousSink',
  args: ['req.body']
};

const cliFlows = [
  {
    flowId: 'flow-parity',
    confidence: 0.91,
    category: 'injection',
    source: { ruleId: 'SRC-1' },
    sink: { ruleId: 'SNK-1' },
    path: {
      labels: ['chunk:chunk-a', 'chunk:chunk-b'],
      callSiteIdsByStep: [['cs-1']]
    },
    callSitesByStep: [[{ callSiteId: 'cs-1', details: callSiteDetails }]]
  }
];

const contextPack = {
  primary: {
    ref: { type: 'chunk', chunkUid: 'chunk-a' },
    file: 'src/app.js',
    excerpt: 'dangerousSink(req.body);'
  },
  risk: {
    status: 'ok',
    summary: {
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 1
      }
    },
    flows: [
      {
        flowId: 'flow-parity',
        confidence: 0.91,
        category: 'injection',
        source: { ruleId: 'SRC-1' },
        sink: { ruleId: 'SNK-1' },
        path: {
          nodes: [
            { type: 'chunk', chunkUid: 'chunk-a' },
            { type: 'chunk', chunkUid: 'chunk-b' }
          ],
          callSiteIdsByStep: [['cs-1']]
        },
        evidence: {
          callSitesByStep: [[{ callSiteId: 'cs-1', details: callSiteDetails }]]
        }
      }
    ]
  }
};

const expectedFlowSection = renderRiskExplain(cliFlows, { maxFlows: 1, maxEvidencePerFlow: 3 });
const expectedRiskSection = buildRiskExplanationPresentationFromRiskSlice(
  contextPack.risk,
  {
    surface: 'contextPack',
    subject: {
      chunkUid: 'chunk-a',
      file: 'src/app.js',
      name: null,
      kind: null
    }
  }
).markdown;
const compositeOutput = renderCompositeContextPack(contextPack);

assert(compositeOutput.includes(expectedFlowSection), 'expected context-pack risk section to share flow explanation rendering');
assert(compositeOutput.includes(expectedRiskSection), 'expected context-pack risk section to reuse shared context-pack presentation');
assert(compositeOutput.includes('src/app.js:27:5 dangerousSink(req.body)'), 'expected detailed call site evidence');

console.log('risk explain parity test passed');
