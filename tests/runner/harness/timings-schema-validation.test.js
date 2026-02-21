#!/usr/bin/env node
import { validateTestTimingsArtifact } from '../../../src/contracts/validators/test-artifacts.js';

const valid = validateTestTimingsArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  totalMs: 1,
  pathPolicy: 'repo-relative-posix',
  timeUnit: 'ms',
  watchdog: {
    triggered: false,
    reason: null
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
  console.error('timings schema validation test failed: expected valid payload pass');
  process.exit(1);
}

const invalid = validateTestTimingsArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  totalMs: 1,
  pathPolicy: 'repo-relative-posix',
  watchdog: {
    triggered: false,
    reason: null
  },
  tests: []
});

if (invalid.ok) {
  console.error('timings schema validation test failed: expected invalid payload fail');
  process.exit(1);
}

console.log('timings schema validation test passed');
