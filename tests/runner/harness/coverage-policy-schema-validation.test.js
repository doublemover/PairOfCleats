#!/usr/bin/env node
import { validateTestCoveragePolicyReportArtifact } from '../../../src/contracts/validators/test-artifacts.js';

const measurement = { changedFiles: 1, eligibleFiles: 1, measuredFiles: 1,
  counts: { observed: 1, unobserved: 0, deleted: 0, absent: 0, unsupported: 0, excluded: 0, unavailable: 0 },
  status: 'complete', denominator: 'observed-ranges-only' };
const inventory = [{ path: 'bin/pairofcleats.js', status: 'observed', reason: null, coveredRanges: 3, totalRanges: 4, coverageFraction: .75 }];
const valid = validateTestCoveragePolicyReportArtifact({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  kind: 'test-coverage-policy-report',
  policyVersion: '2.0.0',
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
    inventory, measurement,
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
      changedInventory: inventory, measurement,
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
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  kind: 'test-coverage-policy-report'
});

if (invalid.ok) {
  console.error('coverage policy schema validation test failed: expected invalid payload fail');
  process.exit(1);
}

console.log('coverage policy schema validation test passed');
