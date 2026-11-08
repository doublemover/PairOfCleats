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

const partialTruncation = [];
const partialRiskTruncation = [];
const partialCapHits = new Set();
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
  truncation: partialTruncation,
  riskTruncation: partialRiskTruncation,
  referencedCallSiteIds: new Set(),
  riskCapHits: partialCapHits
});

assert.equal(partialSelected.selectedRawPartialFlows.length, 5);
assert.equal(partialSelected.omittedPartialFlows, 3);
assert.equal(partialTruncation.some((entry) => entry.cap === 'maxPartialFlows'), true);
assert.equal(partialRiskTruncation.some((entry) => entry.cap === 'maxPartialFlows'), true);
assert.equal(partialCapHits.has('maxPartialFlows'), true);

for (const partial of [false, true]) {
  const ids = new Set();
  const candidates = Array.from({ length: 64 }, (_, index) => {
    const row = buildRankedFlow(index);
    row.flow.source.ruleId = 'x'.repeat(24576);
    row.flow.partialFlowId = 'partial-' + index;
    row.flow.frontier = { chunkUid: 'frontier', blockedExpansions: [{ callSiteIds: ['blocked-' + index] }] };
    return row;
  });
  const select = partial ? selectRiskPartialFlowsWithinBudget : selectRiskFlowsWithinBudget;
  const rejected = select({ [partial ? 'rankedPartialFlows' : 'rankedFlows']: candidates,
    truncation: [], riskTruncation: [], referencedCallSiteIds: ids, riskCapHits: new Set() });
  assert.equal((partial ? rejected.selectedRawPartialFlows : rejected.selectedRawFlows).length, 0);
  assert.deepEqual([...ids], [], 'byte-rejected path/frontier evidence cannot become a hydration dependency');
}

console.log('risk budget trimming test passed');
