#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLaneEvidenceReport, generateLaneEvidence, parseHistoricalTestTimes } from './lane-evidence.js';

const parsed = parseHistoricalTestTimes(`
- 2026-01-18 07:50:10 | \`tests\\cli\\search\\search-removed-flags.test.js\` | 1.03s | timeout
- 2026-01-18 08:08:55 | \`tests\\cli\\search\\search-removed-flags.test.js\` | 3.73s | exit 0
`);

assert.equal(parsed.get('tests/cli/search/search-removed-flags.test.js')?.durationMs, 3730);
assert.equal(parsed.get('cli/search/search-removed-flags.test.js')?.durationMs, 3730);

const report = buildLaneEvidenceReport({
  laneRows: [
    {
      lane: 'ci',
      targetMaxDurationSeconds: 60,
      orderFile: 'tests/ci/ci.order.txt',
      timingArtifactPath: '.testLogs/ci-testRunTimes.txt',
      resolvedTimingArtifactPaths: ['.testLogs/ci-testRunTimes.txt'],
      rows: [
        { id: 'tooling/lsp/a', path: 'tests/tooling/lsp/a.test.js', durationMs: 1200, timingSource: 'timing-artifact' },
        { id: 'cli/search/b', path: 'tests/cli/search/b.test.js', durationMs: 800, timingSource: 'historical-test-times' }
      ]
    },
    {
      lane: 'ci-long',
      targetMaxDurationSeconds: 180,
      orderFile: 'tests/ci-long/ci-long.order.txt',
      timingArtifactPath: '.testLogs/ci-long-testRunTimes.txt',
      rows: [
        { id: 'tooling/lsp/a', path: 'tests/tooling/lsp/a.test.js', durationMs: 1400, timingSource: 'historical-test-times' },
        { id: 'storage/sqlite/c', path: 'tests/storage/sqlite/c.test.js', durationMs: 2200, timingSource: 'historical-test-times' }
      ]
    }
  ]
});

assert.equal(report.summary.exactDuplicates, 1);
assert.equal(report.exactDuplicates[0].id, 'tooling/lsp/a');
assert.equal(report.families[0].key, 'tooling/lsp');
assert.equal(report.hotspots[0].key, 'lsp-bootstrap');
assert.equal(report.topSlowest[0].id, 'storage/sqlite/c');
assert.equal(report.lanes[0].p50DurationMs, 800);
assert.equal(report.lanes[1].p95DurationMs, 2200);
assert.equal(report.summary.timingCoverage.freshArtifactTests, 1);
assert.deepEqual(report.lanes[0].resolvedTimingArtifactPaths, ['.testLogs/ci-testRunTimes.txt']);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lane-evidence-provenance-'));
try {
  await fs.mkdir(path.join(root, 'tests', 'runner'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests', 'ci'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests', 'shared'), { recursive: true });
  await fs.writeFile(path.join(root, 'tests', 'shared', 'historical.test.js'), '');
  await fs.writeFile(path.join(root, 'tests', 'shared', 'measured.test.js'), '');
  await fs.writeFile(path.join(root, 'tests', 'ci', 'ci.order.txt'), 'shared/historical\nshared/measured\n');
  await fs.writeFile(path.join(root, 'tests', 'runner', 'lane-manifests.jsonc'), JSON.stringify({
    orderedLanes: {
      ci: {
        orderFile: 'tests/ci/ci.order.txt',
        manifestFile: 'tests/ci/ci.manifest.json',
        timingArtifactPaths: ['.testLogs/ci-testRunTimes.txt']
      }
    }
  }));
  const historicalTimingsPath = path.join(root, 'history.md');
  await fs.writeFile(historicalTimingsPath, '- 2026-01-18 08:08:55 | `tests/shared/historical.test.js` | 3.73s | exit 0\n');
  const options = {
    root,
    historicalTimingsPath,
    outputJsonPath: path.join(root, 'report.json'),
    outputMarkdownPath: path.join(root, 'report.md')
  };
  const timingPath = path.join(root, '.testLogs', 'ci-testRunTimes.txt');
  for (let run = 0; run < 2; run += 1) {
    const generated = await generateLaneEvidence(options);
    assert.equal(generated.report.summary.timingCoverage.freshArtifactTests, 0);
    assert.equal(generated.report.summary.timingCoverage.historicalFallbackTests, 1);
    await assert.rejects(fs.access(timingPath), 'report generation must not create measured timing inputs');
  }
  await fs.mkdir(path.dirname(timingPath), { recursive: true });
  const measuredTimings = '25ms\tshared/measured\n';
  await fs.writeFile(timingPath, measuredTimings);
  for (let run = 0; run < 2; run += 1) {
    const generated = await generateLaneEvidence(options);
    assert.equal(generated.report.summary.timingCoverage.freshArtifactTests, 1);
    assert.equal(generated.report.summary.timingCoverage.historicalFallbackTests, 1);
    assert.equal(await fs.readFile(timingPath, 'utf8'), measuredTimings, 'measured input must remain byte-for-byte unchanged');
    assert.equal(
      generated.laneRows[0].rows.find((row) => row.id === 'shared/historical').timingSource,
      'historical-test-times'
    );
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('lane evidence test passed');
