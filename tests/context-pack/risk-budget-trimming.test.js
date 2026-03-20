#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  selectRiskFlowsWithinBudget,
  selectRiskPartialFlowsWithinBudget
} from '../../src/context-pack/assemble/budgets.js';

const buildRankedFlow = (index) => ({
  rank: index + 1,
  score: { seedRelevance: 1, severity: 1, confidence: 1, hopCount: index },
  flow: {
    flowId: `flow-${index}`,
    source: { chunkUid: `src-${index}`, ruleType: 'source', tags: [] },
    sink: { chunkUid: `sink-${index}`, ruleType: 'sink', tags: [] },
    confidence: 0.9,
    path: {
      chunkUids: [`src-${index}`, `sink-${index}`],
      callSiteIdsByStep: [[`call-${index}`]],
      watchByStep: [[]]
    },
    notes: { hopCount: index, capsHit: [] }
  }
});

const truncation = [];
const riskTruncation = [];
const referencedCallSiteIds = new Set();
const riskCapHits = new Set();
const flows = Array.from({ length: 8 }, (_, index) => buildRankedFlow(index));
const selected = selectRiskFlowsWithinBudget({
  rankedFlows: flows,
  truncation,
  riskTruncation,
  referencedCallSiteIds,
  riskCapHits
});

assert.equal(selected.selectedRawFlows.length, 5);
assert.equal(selected.omittedFlows, 3);
assert.equal(truncation.some((entry) => entry.cap === 'maxFlows'), true);
assert.equal(referencedCallSiteIds.has('call-0'), true);

const partialSelected = selectRiskPartialFlowsWithinBudget({
  rankedPartialFlows: flows.map((entry) => ({
    rank: entry.rank,
    score: { seedRelevance: 1, confidence: 1, hopCount: entry.rank },
    flow: {
      partialFlowId: `partial-${entry.rank}`,
      source: entry.flow.source,
      confidence: 0.8,
      frontier: { chunkUid: `frontier-${entry.rank}`, blockedExpansions: [] },
      path: entry.flow.path,
      notes: { hopCount: entry.rank, capsHit: [] }
    }
  })),
  truncation: [],
  riskTruncation: [],
  referencedCallSiteIds: new Set(),
  riskCapHits: new Set()
});

assert.equal(partialSelected.selectedRawPartialFlows.length, 5);
assert.equal(partialSelected.omittedPartialFlows, 3);

console.log('risk budget trimming test passed');
