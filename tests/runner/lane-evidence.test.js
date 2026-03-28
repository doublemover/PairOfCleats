#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLaneEvidenceReport, parseHistoricalTestTimes } from './lane-evidence.js';

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
assert.equal(report.summary.timingCoverage.freshArtifactTests, 1);
assert.deepEqual(report.lanes[0].resolvedTimingArtifactPaths, ['.testLogs/ci-testRunTimes.txt']);

console.log('lane evidence test passed');
