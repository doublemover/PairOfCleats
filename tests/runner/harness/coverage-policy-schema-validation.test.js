#!/usr/bin/env node
import { validateTestCoveragePolicyReportArtifact } from '../../../src/contracts/validators/test-artifacts.js';

const valid = validateTestCoveragePolicyReportArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  kind: 'test-coverage-policy-report',
  policyVersion: '1.0.0',
  mode: 'ci',
  sourceCoverageKind: 'v8-range-summary',
  sourceCoverageRunId: 'run-1',
  overall: {
    files: 2,
    coveredRanges: 8,
    totalRanges: 10,
    coverageFraction: 0.8
  },
  changedFiles: {
    available: true,
    strategy: 'explicit-git-range',
    baseRef: 'base',
    headRef: 'head',
    reason: null,
    summary: {
      files: 1,
      coveredRanges: 3,
      totalRanges: 4,
      coverageFraction: 0.75
    },
    files: [
      {
        path: 'bin/pairofcleats.js',
        coveredRanges: 3,
        totalRanges: 4,
        coverageFraction: 0.75
      }
    ]
  },
  criticalSurfaces: [
    {
      id: 'cli',
      label: 'CLI',
      patterns: ['bin/**'],
      summary: {
        files: 1,
        coveredRanges: 3,
        totalRanges: 4,
        coverageFraction: 0.75
      },
      topUncoveredFiles: [
        {
          path: 'bin/pairofcleats.js',
          coveredRanges: 3,
          totalRanges: 4,
          coverageFraction: 0.75
        }
      ]
    }
  ],
  policy: {
    phase: 'report-only',
    progression: ['report', 'review', 'gate']
  }
});

if (!valid.ok) {
  console.error('coverage policy schema validation test failed: expected valid payload pass');
  process.exit(1);
}

const invalid = validateTestCoveragePolicyReportArtifact({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  kind: 'test-coverage-policy-report'
});

if (invalid.ok) {
  console.error('coverage policy schema validation test failed: expected invalid payload fail');
  process.exit(1);
}

console.log('coverage policy schema validation test passed');
