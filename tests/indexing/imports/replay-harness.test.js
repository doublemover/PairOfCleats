#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  aggregateImportResolutionGraphPayloads,
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
} from '../../../src/index/build/import-resolution.js';

const reports = [
  {
    reportPath: 'repo-a/import_resolution_graph.json',
    payload: {
      generatedAt: new Date().toISOString(),
      stats: {},
      warnings: [
        {
          importer: 'src\\main.js',
          specifier: './missing.js',
          reason: 'missing',
          resolutionState: 'unresolved',
          reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
          failureCause: 'missing_file',
          disposition: 'actionable',
          resolverStage: 'filesystem_probe'
        },
        {
          importer: 'src/parser.js',
          specifier: './fixture.txt',
          reason: 'fixture',
          resolutionState: 'unresolved',
          reasonCode: 'IMP_U_FIXTURE_REFERENCE',
          failureCause: 'parser_artifact',
          disposition: 'suppress_live',
          resolverStage: 'classify'
        },
        {
          importer: 'src/build.bzl',
          specifier: '//pkg:generated_target',
          reason: 'resolver gap',
          resolutionState: 'unresolved',
          reasonCode: 'IMP_U_RESOLVER_GAP',
          failureCause: 'resolver_gap',
          disposition: 'suppress_gate',
          resolverStage: 'language_resolver'
        },
        {
          importer: 'tests/integration.spec.js',
          specifier: './missing-in-tests.js',
          reason: 'test-only',
          resolutionState: 'unresolved',
          reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
          failureCause: 'missing_file',
          disposition: 'actionable',
          resolverStage: 'filesystem_probe'
        }
      ]
    }
  },
  {
    reportPath: 'repo-b/import_resolution_graph.json',
    payload: null
  }
];

const aggregated = aggregateImportResolutionGraphPayloads(reports, {
  excludedImporterSegments: DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
});

assert.equal(aggregated.totals.reportCount, 1, 'expected one valid report');
assert.equal(aggregated.invalidReports.length, 1, 'expected one invalid report');
assert.equal(aggregated.totals.unresolved, 3, 'expected excluded test importer warning to be removed from gate counts');
assert.equal(aggregated.totals.actionable, 1, 'expected one actionable unresolved warning');
assert.equal(aggregated.totals.parserArtifact, 1, 'expected parser artifact count to be replayed');
assert.equal(aggregated.totals.resolverGap, 1, 'expected resolver gap count to be replayed');
assert.equal(aggregated.reasonCodeCounts.IMP_U_MISSING_FILE_RELATIVE, 2, 'expected reason code counts to include excluded warning');
assert.equal(aggregated.resolverStages.filesystem_probe, 2, 'expected stage counts to include all observed warnings');
assert.deepEqual(
  aggregated.actionableByRepo,
  { 'repo-a': 1 },
  'expected actionable repo hotspot rollup'
);
assert.deepEqual(
  aggregated.actionableByLanguage,
  { js: 1 },
  'expected actionable language hotspot rollup'
);
assert.deepEqual(
  aggregated.actionableHotspots,
  [{ importer: 'src/main.js', count: 1 }],
  'expected actionable hotspot importer path normalization during replay'
);

console.log('import-resolution replay harness test passed');
