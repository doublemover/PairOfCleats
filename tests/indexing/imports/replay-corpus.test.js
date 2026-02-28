#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
  aggregateImportResolutionGraphPayloads,
  discoverImportResolutionGraphReports,
  loadImportResolutionGraphReports
} from '../../../src/index/build/import-resolution.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'import-resolution', 'replay-corpus');

const discovered = await discoverImportResolutionGraphReports({
  rootDir: fixtureRoot,
  scanRoots: ['.'],
  maxReports: 16
});
assert.equal(discovered.length, 3, 'expected three replay corpus graph files');

const loaded = await loadImportResolutionGraphReports(discovered);
const aggregated = aggregateImportResolutionGraphPayloads(loaded, {
  excludedImporterSegments: DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
});

assert.equal(aggregated.totals.reportCount, 2, 'expected two valid replay reports');
assert.equal(aggregated.invalidReports.length, 1, 'expected one invalid replay report');
assert.equal(aggregated.totals.unresolved, 10, 'expected unresolved counts from warning/stats replay');
assert.equal(aggregated.totals.actionable, 3, 'expected actionable counts from warning/stats replay');
assert.equal(aggregated.totals.parserArtifact, 1, 'expected parser-artifact replay count');
assert.equal(aggregated.totals.resolverGap, 3, 'expected resolver-gap replay count');
assert.equal(aggregated.totals.resolverBudgetExhausted, 2, 'expected budget-exhausted replay count');
assert.equal(aggregated.totals.resolverBudgetAdaptiveReports, 1, 'expected one adaptive budget report');
assert.deepEqual(
  aggregated.actionableByRepo,
  {
    'repo-alpha': 1,
    'repo-beta': 1
  },
  'expected actionable repo hotspot counts'
);
assert.deepEqual(
  aggregated.actionableByLanguage,
  {
    ts: 2
  },
  'expected actionable language hotspot counts'
);
assert.deepEqual(
  aggregated.actionableHotspots,
  [
    { importer: 'src/service.ts', count: 2 },
    { importer: 'src/main.ts', count: 1 }
  ],
  'expected actionable importer hotspot aggregation'
);
assert.deepEqual(
  aggregated.resolverBudgetPolicyProfiles,
  { fd_pressure: 1, normal: 1 },
  'expected replay budget profiles from mixed stats payloads'
);

console.log('import-resolution replay corpus test passed');
