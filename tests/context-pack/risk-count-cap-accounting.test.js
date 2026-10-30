import assert from 'node:assert/strict';
import { rankRiskFlows, rankPartialRiskFlows } from '../../src/context-pack/risk-ranking.js';
import { selectRiskFlowsWithinBudget, selectRiskPartialFlowsWithinBudget } from '../../src/context-pack/assemble/budgets.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
for (const partial of [false, true]) {
  const flows = Array.from({ length: 7 }, (_, index) => ({
    flowId: String(index), partialFlowId: String(index), confidence: 1 - index / 100,
    source: { chunkUid: 'seed', ruleName: index === 0 ? 'x'.repeat(30000) : 'source' },
    sink: { chunkUid: 'sink', severity: 'high' },
    frontier: { chunkUid: 'frontier', terminalReason: 'unresolved', blockedExpansions: [] },
    path: { chunkUids: ['seed', 'sink'], callSiteIdsByStep: [] }, notes: { hopCount: 1 }
  }));
  const anchor = { kind: 'source', chunkUid: 'seed' };
  const ranked = (partial ? rankPartialRiskFlows : rankRiskFlows)(flows, anchor);
  for (const input of [ranked, (partial ? rankPartialRiskFlows : rankRiskFlows)([...flows].reverse(), anchor)]) {
    const details = [], hits = new Set();
    const common = { referencedCallSiteIds: new Set(), riskCapHits: hits,
      recordRiskTruncation: (cap, detail) => details.push({ cap, ...detail }) };
    const selected = partial
      ? selectRiskPartialFlowsWithinBudget({ ...common, rankedPartialFlows: input })
      : selectRiskFlowsWithinBudget({ ...common, rankedFlows: input });
    assert.equal((partial ? selected.selectedRawPartialFlows : selected.selectedRawFlows).length, 5);
    assert.equal(partial ? selected.omittedPartialFlows : selected.omittedFlows, 2);
    assert.ok(hits.has(partial ? 'maxPartialBytes' : 'maxRiskBytes'));
    const count = details.find(detail => detail.cap === (partial ? 'maxPartialFlows' : 'maxFlows'));
    assert.equal(count.limit, 5); assert.equal(count.observed, 7);
    assert.equal(count.omitted, 1, 'count-cap omissions exclude the earlier byte-budget rejection');
    assert.deepEqual((partial ? selected.selectedRawPartialFlows : selected.selectedRawFlows)
      .map(flow => partial ? flow.partialFlowId : flow.flowId), ['1', '2', '3', '4', '5']);
  }
}
console.log('Full and partial risk count caps account only for their own omissions.');
