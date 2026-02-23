#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { finalizeArtifactWriteTelemetry } from '../../../src/index/build/artifacts/write-telemetry.js';

applyTestEnv({ testing: '1' });

const pieceEntries = [
  { path: 'zeta.json', type: 'stats', name: 'zeta', bytes: 77 },
  { path: 'alpha.json', type: 'postings', name: 'alpha-postings', count: 12, checksum: 'sha1:aaa' },
  { path: 'alpha.json', type: 'stats', name: 'alpha-stats' },
  { path: 'beta.json', type: 'postings', name: 'beta-postings', compression: 'zstd' }
];
const artifactMetrics = new Map([
  ['beta.json', { path: 'beta.json', bytes: 44, checksumAlgo: 'sha1', checksum: 'bbbb', durationMs: 120, queueDelayMs: 200 }],
  ['zeta.json', { path: 'zeta.json', durationMs: 90, queueDelayMs: 20 }],
  ['alpha.json', { path: 'alpha.json', bytes: 33, durationMs: 30, queueDelayMs: 5 }]
]);
const timing = {};
const cleanupActions = [{ targetPath: 'stale.bin', policy: 'legacy' }];

finalizeArtifactWriteTelemetry({
  pieceEntries,
  artifactMetrics,
  timing,
  cleanupActions,
  writeFsStrategy: { mode: 'generic' },
  profileId: 'balanced'
});

assert.deepEqual(
  pieceEntries.map((entry) => `${entry.path}|${entry.type}|${entry.name}`),
  [
    'alpha.json|postings|alpha-postings',
    'alpha.json|stats|alpha-stats',
    'beta.json|postings|beta-postings',
    'zeta.json|stats|zeta'
  ],
  'expected deterministic piece sorting by path, type, then name'
);

const alphaMetric = artifactMetrics.get('alpha.json');
assert.equal(alphaMetric?.count, 12, 'expected piece metadata to enrich artifact metric rows');
assert.equal(alphaMetric?.checksumAlgo, 'sha1', 'expected checksum algorithm propagation from piece row');
assert.equal(alphaMetric?.checksum, 'aaa', 'expected checksum propagation from piece row');

const betaEntry = pieceEntries.find((entry) => entry.path === 'beta.json');
assert.equal(betaEntry?.bytes, 44, 'expected piece bytes to backfill from write metric rows');
assert.equal(betaEntry?.checksum, 'sha1:bbbb', 'expected piece checksum to backfill from write metric rows');

assert.deepEqual(
  timing.artifacts.map((entry) => entry.path),
  ['alpha.json', 'beta.json', 'zeta.json'],
  'expected timing artifact rows sorted deterministically by path'
);
assert.equal(timing.cleanup?.profileId, 'balanced', 'expected cleanup telemetry to carry profile id');
assert.deepEqual(timing.cleanup?.actions, cleanupActions, 'expected cleanup telemetry actions to be preserved');
assert.equal(
  timing.cleanup?.artifactLatencyClasses?.total,
  3,
  'expected latency-class summary to count finalized metric rows'
);

console.log('artifact write telemetry finalization test passed');
