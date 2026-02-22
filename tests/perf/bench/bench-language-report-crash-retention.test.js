#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

ensureTestingEnv(process.env);

const output = buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  config: {
    perl: { label: 'Perl' }
  },
  results: [
    {
      language: 'perl',
      tier: 'typical',
      repo: 'owner/repo',
      summary: null,
      failed: true,
      failureReason: 'bench',
      diagnostics: {
        crashRetention: {
          bundlePath: '/tmp/results/logs/run-diagnostics/owner-repo/retained-crash-bundle.json',
          markerPath: '/tmp/results/logs/run-diagnostics/owner-repo/retained-crash-bundle.consistency.json',
          checksum: 'sha1:abc123'
        }
      }
    },
    {
      language: 'perl',
      tier: 'typical',
      repo: 'owner/repo-2',
      summary: null,
      failed: true,
      failureReason: 'bench'
    }
  ]
});

assert.ok(output.diagnostics, 'expected diagnostics section in report output');
assert.equal(output.diagnostics.crashRetention.retainedCount, 1, 'expected one retained crash bundle');
assert.equal(output.diagnostics.crashRetention.retained[0].repo, 'owner/repo', 'expected retained repo entry');
assert.equal(
  output.diagnostics.crashRetention.retained[0].bundlePath,
  '/tmp/results/logs/run-diagnostics/owner-repo/retained-crash-bundle.json',
  'expected retained bundle path surfaced in report'
);

console.log('bench language report crash retention test passed');
