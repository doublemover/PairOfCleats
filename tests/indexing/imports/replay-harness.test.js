#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  aggregateImportResolutionGraphPayloads,
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
  discoverImportResolutionGraphReports,
  loadImportResolutionGraphReports
} from '../../../src/index/build/import-resolution.js';

const reports = [
  {
    reportPath: 'repo-a/import_resolution_graph.json',
    payload: {
      generatedAt: new Date().toISOString(),
      stats: {
        resolverPipelineStages: {
          language_resolver: {
            attempts: 2,
            hits: 1,
            misses: 1,
            elapsedMs: 1.25,
            budgetExhausted: 1,
            degraded: 2
          }
        }
      },
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
  aggregated.resolverPipelineStages,
  Object.assign(Object.create(null), {
    language_resolver: {
      attempts: 2,
      hits: 1,
      misses: 1,
      elapsedMs: 1.25,
      budgetExhausted: 1,
      degraded: 2
    }
  }),
  'expected resolver stage pipeline metrics to aggregate with budget/degraded counters'
);
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

const replayRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-replay-harness-'));
try {
  const reportPathA = path.join(replayRoot, '.benchCache', 'repo-c', 'import_resolution_graph.json');
  const reportPathB = path.join(replayRoot, '.testCache', 'repo-d', 'import_resolution_graph.json');
  const reportPathIgnored = path.join(replayRoot, '.testCache', 'repo-d', 'not_import_graph.json');
  await fs.mkdir(path.dirname(reportPathA), { recursive: true });
  await fs.mkdir(path.dirname(reportPathB), { recursive: true });
  await fs.writeFile(reportPathA, JSON.stringify({ generatedAt: new Date().toISOString() }, null, 2));
  await fs.writeFile(reportPathB, '{');
  await fs.writeFile(reportPathIgnored, 'noop');

  const discovered = await discoverImportResolutionGraphReports({
    rootDir: replayRoot,
    maxReports: 8
  });
  assert.deepEqual(
    discovered.map((entry) => entry.replace(/\\/g, '/')),
    [reportPathA, reportPathB].map((entry) => entry.replace(/\\/g, '/')).sort(),
    'expected replay report discovery to only include import_resolution_graph.json files'
  );

  const loaded = await loadImportResolutionGraphReports(discovered);
  assert.equal(loaded.length, 2, 'expected two loaded replay reports');
  assert.equal(
    loaded.filter((entry) => entry.payload && typeof entry.payload === 'object').length,
    1,
    'expected one valid replay report payload'
  );
  assert.equal(
    loaded.filter((entry) => entry.payload == null).length,
    1,
    'expected one invalid replay report payload'
  );
} finally {
  await fs.rm(replayRoot, { recursive: true, force: true });
}

console.log('import-resolution replay harness test passed');
