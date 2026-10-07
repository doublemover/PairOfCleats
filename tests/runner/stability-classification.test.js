#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildStabilityArtifact, stabilitySlowThresholdsForTests } from './run-stability.js';
import { repoRoot } from '../helpers/root.js';
import { loadDiagnosticsGovernance } from './diagnostics-governance.js';

const ROOT = repoRoot();
const currentFingerprint = `${process.platform}|${process.arch}|${process.version}|ci|ci-lite|ci`;
const diagnosticsGovernance = (await loadDiagnosticsGovernance({ root: ROOT })).payload;

const makeHistoryArtifact = ({ fingerprint, rows }) => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: `history-${fingerprint}`,
  environment: {
    fingerprint
  },
  tests: rows.map((row) => ({
    ...row,
    environmentFingerprint: fingerprint
  }))
});

const artifact = buildStabilityArtifact({
  runId: 'run-current',
  root: ROOT,
  laneLabel: 'ci-lite',
  retries: 1,
  baseEnv: {
    CI: '1',
    PAIROFCLEATS_SUITE_MODE: 'ci'
  },
  history: {
    sourceDir: '.testLogs/stability-history/ci-lite',
    historyLimit: 12,
    artifacts: [
      makeHistoryArtifact({
        fingerprint: currentFingerprint,
        rows: [
          {
            id: 'services/api/flaky',
            outcomeClass: 'failed',
            durationMs: 120,
            status: 'failed'
          },
          {
            id: 'services/api/slow',
            outcomeClass: 'passed',
            durationMs: 9000,
            status: 'passed'
          }
        ]
      }),
      makeHistoryArtifact({
        fingerprint: 'linux|x64|v22|ci|ci-lite',
        rows: [
          {
            id: 'services/api/env-sensitive',
            outcomeClass: 'passed',
            durationMs: 150,
            status: 'passed'
          }
        ]
      })
    ]
  },
  timeoutResolver: () => 15000,
  results: [
    {
      id: 'services/api/flaky',
      relPath: 'services/api/flaky.test.js',
      lane: 'api',
      status: 'passed',
      durationMs: 100,
      timedOut: false
    },
    {
      id: 'services/api/slow',
      relPath: 'services/api/slow.test.js',
      lane: 'api',
      status: 'passed',
      durationMs: 7600,
      timedOut: false
    },
    {
      id: 'services/api/env-sensitive',
      relPath: 'services/api/env-sensitive.test.js',
      lane: 'api',
      status: 'failed',
      durationMs: 100,
      timedOut: false
    },
    {
      id: 'cli/error-contract',
      relPath: 'cli/error-contract.test.js',
      lane: 'ci-lite',
      suiteCategory: 'hero',
      status: 'passed',
      durationMs: 80,
      timedOut: false,
      stderr: '[INVALID_REQUEST] expected contract'
    }
  ],
  diagnosticsGovernance
});

const byId = new Map(artifact.tests.map((row) => [row.id, row]));

assert.equal(byId.get('services/api/flaky')?.stabilityClass, 'flaky');
assert.equal(byId.get('services/api/slow')?.stabilityClass, 'slow');
assert.equal(byId.get('services/api/env-sensitive')?.stabilityClass, 'environment-sensitive');
assert.equal(byId.get('cli/error-contract')?.diagnosticsClass, 'expected-negative-stderr');
assert.equal(
  byId.get('services/api/slow')?.timeoutBudgetMs,
  15000,
  'expected timeout budget to flow into slow classification'
);
assert.equal(
  artifact.summary.unstable,
  3,
  'expected all three rows to classify as unstable in different ways'
);
assert.equal(
  artifact.families.find((entry) => entry.id === 'services/api')?.tests,
  3,
  'expected family rollup to count all service API rows'
);
assert.equal(artifact.summary.expectedNegativeStderr, 1);
assert.ok(artifact.suiteCategories.hero >= 1, 'expected hero suite category count to be recorded');
assert.equal(artifact.policy.retryBySuiteCategory.matrix.maxRetries, 1);
assert.equal(stabilitySlowThresholdsForTests.warnFraction, 0.5);

console.log('stability classification test passed');
