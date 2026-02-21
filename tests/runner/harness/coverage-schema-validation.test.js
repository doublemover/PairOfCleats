#!/usr/bin/env node
import { validateTestCoverageArtifact } from '../../../src/contracts/validators/test-artifacts.js';

const valid = validateTestCoverageArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  pathPolicy: 'repo-relative-posix',
  kind: 'v8-range-summary',
  summary: {
    files: 1,
    coveredRanges: 1,
    totalRanges: 1
  },
  entries: [
    {
      path: 'src/index.js',
      coveredRanges: 1,
      totalRanges: 1
    }
  ]
});

if (!valid.ok) {
  console.error('coverage schema validation test failed: expected valid payload pass');
  process.exit(1);
}

const invalid = validateTestCoverageArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: 'run-1',
  pathPolicy: 'repo-relative-posix',
  summary: { files: 1, coveredRanges: 1, totalRanges: 1 },
  entries: []
});

if (invalid.ok) {
  console.error('coverage schema validation test failed: expected invalid payload fail');
  process.exit(1);
}

console.log('coverage schema validation test passed');
