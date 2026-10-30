#!/usr/bin/env node
import assert from 'node:assert/strict';
import { withGeneratedArtifactMetadata } from '../../../src/shared/generated-artifact-core.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import {
  buildDeterminismReport,
  stripIndexStateNondeterministicFields
} from '../../../src/index/build/artifacts/reporting.js';

const sharedState = withGeneratedArtifactMetadata({
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  compatibilityKey: 'compat-test',
  profile: { id: 'default' }
}, 'index-state');

const reportA = buildDeterminismReport({
  mode: 'code',
  indexState: {
    ...sharedState,
    generatedAt: '2026-02-21T00:00:00.000Z',
    updatedAt: '2026-02-21T00:00:01.000Z',
    buildId: '20260221T000000Z_runA',
    extensions: { ...sharedState.extensions, runtimeAttemptId: 'attempt-A' }
  }
});

const reportB = buildDeterminismReport({
  mode: 'code',
  indexState: {
    ...sharedState,
    generatedAt: '2026-02-21T00:05:00.000Z',
    updatedAt: '2026-02-21T00:05:01.000Z',
    buildId: '20260221T000500Z_runB',
    extensions: { ...sharedState.extensions, runtimeAttemptId: 'attempt-B' }
  }
});

assert.ok(reportA.stableHashExclusions.includes('buildId'), 'buildId should be excluded from stable hash');
assert.ok(reportA.stableHashExclusions.includes('extensions.runtimeAttemptId'));
assert.equal(
  reportA.normalizedStateHash,
  reportB.normalizedStateHash,
  'buildId/timestamp changes should not affect normalizedStateHash'
);

const stripped = stripIndexStateNondeterministicFields({
  ...sharedState,
  generatedAt: '2026-02-21T00:00:00.000Z',
  updatedAt: '2026-02-21T00:00:01.000Z',
  buildId: '20260221T000000Z_runA',
  extensions: { ...sharedState.extensions, runtimeAttemptId: 'attempt-A' }
}, { forStableHash: true });

assert.ok(!('generatedAt' in stripped), 'generatedAt should be removed for stable hash');
assert.ok(!('updatedAt' in stripped), 'updatedAt should be removed for stable hash');
assert.ok(!('buildId' in stripped), 'buildId should be removed for stable hash');
assert.equal(stripped.extensions.runtimeAttemptId, undefined);
assert.deepEqual(stripped.extensions.__poc_generated, sharedState.extensions.__poc_generated);
const changed = structuredClone(sharedState);
changed.extensions.__poc_generated.format = 'poc.generated@2';
assert.notEqual(buildDeterminismReport({ indexState: changed }).normalizedStateHash,
  reportA.normalizedStateHash, 'marker protocol changes must deliberately invalidate stable hashes');

console.log('determinism report stable hash exclusions test passed');
