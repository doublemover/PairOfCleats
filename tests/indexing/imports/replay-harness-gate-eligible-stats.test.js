#!/usr/bin/env node
import assert from 'node:assert/strict';
import { aggregateImportResolutionGraphPayloads } from '../../../src/index/build/import-resolution.js';

const aggregated = aggregateImportResolutionGraphPayloads([
  {
    reportPath: 'repo-gamma/import_resolution_graph.json',
    payload: {
      generatedAt: new Date().toISOString(),
      stats: {
        unresolved: 100,
        unresolvedActionable: 40,
        unresolvedGateEligible: 4,
        unresolvedActionableGateEligible: 1
      },
      warnings: []
    }
  }
]);

assert.equal(aggregated.totals.reportCount, 1, 'expected one replay report');
assert.equal(aggregated.totals.unresolved, 4, 'expected gate-eligible unresolved stats precedence');
assert.equal(aggregated.totals.actionable, 1, 'expected gate-eligible actionable stats precedence');
assert.equal(aggregated.totals.gateEligibleUnresolved, 4, 'expected gate-eligible unresolved totals');
assert.equal(aggregated.totals.gateEligibleActionable, 1, 'expected gate-eligible actionable totals');
assert.deepEqual(
  aggregated.actionableByRepo,
  { 'repo-gamma': 1 },
  'expected actionable repo rollup to align with gate-eligible actionable totals'
);

const clamped = aggregateImportResolutionGraphPayloads([
  {
    reportPath: 'repo-overflow/import_resolution_graph.json',
    payload: {
      generatedAt: new Date().toISOString(),
      stats: {
        unresolvedGateEligible: 2,
        unresolvedActionableGateEligible: 5
      },
      warnings: []
    }
  }
]);
assert.equal(clamped.totals.unresolved, 2, 'expected unresolved totals to preserve gate-eligible unresolved counts');
assert.equal(clamped.totals.actionable, 2, 'expected actionable totals to clamp at unresolved counts');
assert.equal(clamped.totals.gateEligibleUnresolved, 2, 'expected gate-eligible unresolved totals');
assert.equal(clamped.totals.gateEligibleActionable, 2, 'expected clamped gate-eligible actionable totals');

console.log('import-resolution replay harness gate-eligible stats test passed');
