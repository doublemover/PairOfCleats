#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { aggregateThroughputReport } from '../../../tools/reports/show-throughput/aggregate-report.js';

ensureTestingEnv(process.env);

const indexingSummary = {
  schemaVersion: 1,
  generatedAt: '2026-02-22T00:00:00.000Z',
  source: 'feature-metrics',
  modes: {
    code: {
      files: 4,
      lines: 100,
      bytes: 2048,
      durationMs: 2000,
      linesPerSec: 50
    },
    prose: { files: 0, lines: 0, bytes: 0, durationMs: 0, linesPerSec: null },
    'extracted-prose': { files: 0, lines: 0, bytes: 0, durationMs: 0, linesPerSec: null },
    records: { files: 0, lines: 0, bytes: 0, durationMs: 0, linesPerSec: null }
  },
  totals: {
    files: 4,
    lines: 100,
    bytes: 2048,
    durationMs: 2000,
    linesPerSec: 50
  },
  languageLines: {
    javascript: 80
  }
};

const createRun = ({ file, generatedAtMs, chunks }) => ({
  file,
  summary: null,
  throughput: {
    code: {
      files: 4,
      chunks,
      tokens: chunks * 10,
      bytes: chunks * 100,
      totalMs: 1000
    }
  },
  featureMetrics: null,
  analysis: null,
  indexingSummary,
  throughputLedger: null,
  repoIdentity: 'C:/repo',
  repoMetricsKey: 'C:/repo',
  generatedAtMs
});

const report = aggregateThroughputReport([
  {
    name: 'javascript',
    runs: [
      createRun({
        file: 'owner__repo-current.json',
        generatedAtMs: Date.parse('2026-02-22T00:05:00.000Z'),
        chunks: 150
      }),
      createRun({
        file: 'owner__repo-baseline.json',
        generatedAtMs: Date.parse('2026-02-22T00:00:00.000Z'),
        chunks: 300
      })
    ]
  }
]);

assert.equal(report.folders.length, 1, 'expected one folder aggregate');
assert.equal(report.folders[0].runs[0].file, 'owner__repo-baseline.json', 'expected chronological run sorting');
assert.equal(
  report.folders[0].modeTotals.get('code').lines,
  100,
  'expected per-folder indexing totals to dedupe by repo identity'
);
assert.equal(
  report.global.modeTotals.get('code').lines,
  100,
  'expected global indexing totals to dedupe by repo identity'
);
assert.equal(
  report.global.languageTotals.get('javascript'),
  80,
  'expected language totals to dedupe by repo identity'
);
assert.equal(report.global.totalsRates.totalChunksPerSec, 225, 'expected weighted chunk rate from merged totals');
assert.equal(report.global.modeRows[0].linesPerSec, 50, 'expected code lines/s from deduped indexing summary');

console.log('show-throughput aggregate report test passed');
