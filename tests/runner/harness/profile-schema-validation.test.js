#!/usr/bin/env node
import { validateTestProfileArtifact } from '../../../src/contracts/validators/test-artifacts.js';

const valid = validateTestProfileArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  pathPolicy: 'repo-relative-posix',
  timeUnit: 'ms',
  summary: {
    totalMs: 1,
    tests: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    watchdogTriggered: false
  },
  tests: [
    {
      id: 'runner/harness/pass-target',
      path: 'tests/runner/harness/pass-target.test.js',
      lane: 'unit',
      status: 'passed',
      durationMs: 1
    }
  ]
});

if (!valid.ok) {
  console.error('profile schema validation test failed: expected valid payload pass');
  process.exit(1);
}

const invalid = validateTestProfileArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  pathPolicy: 'repo-relative-posix',
  summary: {
    totalMs: 1,
    tests: 1,
    passed: 1,
    failed: 0,
    skipped: 0
  },
  tests: []
});

if (invalid.ok) {
  console.error('profile schema validation test failed: expected invalid payload fail');
  process.exit(1);
}

console.log('profile schema validation test passed');
