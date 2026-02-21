#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildDeterminismReport,
  stripIndexStateNondeterministicFields
} from '../../../src/index/build/artifacts/reporting.js';

const sharedState = {
  mode: 'code',
  artifactSurfaceVersion: '2.0.0',
  compatibilityKey: 'compat-test',
  profile: { id: 'default' }
};

const reportA = buildDeterminismReport({
  mode: 'code',
  indexState: {
    ...sharedState,
    generatedAt: '2026-02-21T00:00:00.000Z',
    updatedAt: '2026-02-21T00:00:01.000Z',
    buildId: '20260221T000000Z_runA'
  }
});

const reportB = buildDeterminismReport({
  mode: 'code',
  indexState: {
    ...sharedState,
    generatedAt: '2026-02-21T00:05:00.000Z',
    updatedAt: '2026-02-21T00:05:01.000Z',
    buildId: '20260221T000500Z_runB'
  }
});

assert.ok(reportA.stableHashExclusions.includes('buildId'), 'buildId should be excluded from stable hash');
assert.equal(
  reportA.normalizedStateHash,
  reportB.normalizedStateHash,
  'buildId/timestamp changes should not affect normalizedStateHash'
);

const stripped = stripIndexStateNondeterministicFields({
  ...sharedState,
  generatedAt: '2026-02-21T00:00:00.000Z',
  updatedAt: '2026-02-21T00:00:01.000Z',
  buildId: '20260221T000000Z_runA'
}, { forStableHash: true });

assert.ok(!('generatedAt' in stripped), 'generatedAt should be removed for stable hash');
assert.ok(!('updatedAt' in stripped), 'updatedAt should be removed for stable hash');
assert.ok(!('buildId' in stripped), 'buildId should be removed for stable hash');

console.log('determinism report stable hash exclusions test passed');
