#!/usr/bin/env node
import assert from 'node:assert';
import { renderRiskExplain } from '../../../src/retrieval/output/risk-explain.js';

const flows = [
  {
    flowId: 'flow-1',
    confidence: 0.88,
    category: 'injection',
    source: { ruleId: 'SRC1' },
    sink: { ruleId: 'SNK1' },
    path: {
      nodes: [
        { type: 'chunk', chunkUid: 'chunk-a' },
        { type: 'chunk', chunkUid: 'chunk-b' }
      ],
      callSiteIdsByStep: [["cs-1", "cs-2"]]
    }
  }
];

const output = renderRiskExplain(flows, { maxFlows: 1, maxEvidencePerFlow: 2 });
assert(output.includes('flow-1'), 'expected flow id in output');
assert(output.includes('chunk:chunk-a'), 'expected path nodes in output');
assert(output.includes('cs-1'), 'expected call site evidence in output');
console.log('risk explain render test passed');
