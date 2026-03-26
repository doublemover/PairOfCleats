#!/usr/bin/env node
import { validateTestStabilityArtifact } from '../../../src/contracts/validators/test-artifacts.js';

const valid = validateTestStabilityArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  pathPolicy: 'repo-relative-posix',
  timeUnit: 'ms',
  lane: 'ci-lite',
  history: {
    sourceDir: '.testLogs/stability-history/ci-lite',
    loadedArtifacts: 1,
    historyLimit: 12
  },
  environment: {
    fingerprint: 'win32|x64|v1|ci|ci-lite',
    platform: 'win32',
    arch: 'x64',
    node: 'v1',
    ci: true,
    suiteMode: 'ci'
  },
  policy: {
    retry: {
      runnerRetries: 1,
      automaticRetryEnabled: true,
      note: 'visible retries'
    },
    quarantine: {
      automaticQuarantine: false,
      note: 'manual only'
    },
    escalation: {
      flaky: 'owner-review-and-repeat-run',
      slow: 'budget-review-shard-or-harness-reuse',
      environmentSensitive: 'fingerprint-review-and-environment-normalization'
    }
  },
  summary: {
    tests: 1,
    unstable: 1,
    flaky: 1,
    slow: 0,
    environmentSensitive: 0,
    failed: 0,
    timedOut: 0,
    redo: 0
  },
  families: [
    {
      id: 'runner/harness',
      tests: 1,
      unstable: 1,
      flaky: 1,
      slow: 0,
      environmentSensitive: 0,
      failed: 0,
      timedOut: 0,
      redo: 0,
      avgDurationMs: 1,
      maxDurationMs: 1
    }
  ],
  tests: [
    {
      id: 'runner/harness/pass-target',
      path: 'tests/runner/harness/pass-target.test.js',
      lane: 'unit',
      family: 'runner/harness',
      status: 'passed',
      durationMs: 1,
      timeoutBudgetMs: 15000,
      stabilityClass: 'flaky',
      outcomeClass: 'passed',
      historyWindow: 1,
      historyOutcomes: ['failed'],
      historyEnvironments: ['win32|x64|v1|ci|ci-lite'],
      environmentFingerprint: 'win32|x64|v1|ci|ci-lite'
    }
  ]
});

if (!valid.ok) {
  console.error('stability schema validation test failed: expected valid payload pass');
  process.exit(1);
}

const invalid = validateTestStabilityArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  pathPolicy: 'repo-relative-posix',
  timeUnit: 'ms',
  lane: 'ci-lite',
  history: {
    sourceDir: null,
    loadedArtifacts: 0,
    historyLimit: 12
  },
  environment: {
    fingerprint: 'x',
    platform: 'win32',
    arch: 'x64',
    node: 'v1',
    ci: true,
    suiteMode: 'ci'
  },
  policy: {
    retry: {
      runnerRetries: 0,
      automaticRetryEnabled: false,
      note: 'none'
    },
    quarantine: {
      automaticQuarantine: false,
      note: 'manual'
    },
    escalation: {
      flaky: 'review',
      slow: 'review',
      environmentSensitive: 'review'
    }
  },
  summary: {
    tests: 0,
    unstable: 0,
    flaky: 0,
    slow: 0,
    environmentSensitive: 0,
    failed: 0,
    timedOut: 0,
    redo: 0
  },
  families: [],
  tests: [
    {
      id: 'runner/harness/pass-target',
      path: 'tests/runner/harness/pass-target.test.js',
      lane: 'unit',
      family: 'runner/harness',
      status: 'passed',
      durationMs: 1,
      timeoutBudgetMs: 15000,
      stabilityClass: 'unknown',
      outcomeClass: 'passed',
      historyWindow: 0,
      historyOutcomes: [],
      historyEnvironments: [],
      environmentFingerprint: 'x'
    }
  ]
});

if (invalid.ok) {
  console.error('stability schema validation test failed: expected invalid payload fail');
  process.exit(1);
}

console.log('stability schema validation test passed');
