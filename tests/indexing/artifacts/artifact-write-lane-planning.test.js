#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  resolveArtifactWriteWeight,
  scheduleArtifactWrites,
  splitScheduledArtifactWriteLanes
} from '../../../src/index/build/artifacts/write-lane-planning.js';

applyTestEnv({ testing: '1' });

assert.equal(
  resolveArtifactWriteWeight(null),
  0,
  'expected invalid entries to resolve to zero scheduling weight'
);

const scheduled = scheduleArtifactWrites([
  { label: 'optional-a.json', estimatedBytes: 2 * 1024, priority: 0, seq: 9 },
  { label: 'debug.json', estimatedBytes: 8 * 1024, priority: 10, seq: 1 },
  { label: 'pieces/manifest.json', estimatedBytes: 4 * 1024, priority: 0, seq: 3 },
  { label: 'optional-b.json', estimatedBytes: 2 * 1024, priority: 0, seq: 4 }
]);
assert.deepEqual(
  scheduled.map((entry) => entry.label),
  ['pieces/manifest.json', 'debug.json', 'optional-b.json', 'optional-a.json'],
  'expected validation-critical artifacts to outrank optional outputs and preserve FIFO tie order'
);

const laneSplit = splitScheduledArtifactWriteLanes({
  entries: [
    { label: 'blob.micro.meta.json', estimatedBytes: 4 * 1024, priority: 0, seq: 3 },
    { label: 'blob.regular-a.json', estimatedBytes: 200 * 1024, priority: 0, seq: 4 },
    { label: 'blob.massive-override.json', estimatedBytes: 8 * 1024, priority: 0, seq: 0 },
    { label: 'blob.heavy-override.json', estimatedBytes: 8 * 1024, priority: 0, seq: 1 },
    { label: 'blob.micro.override.json', estimatedBytes: 5 * 1024 * 1024, priority: 0, seq: 2 },
    { label: 'blob.massive-size.json', estimatedBytes: 200 * 1024 * 1024, priority: 0, seq: 5 }
  ],
  heavyWriteThresholdBytes: 1024 * 1024,
  ultraLightWriteThresholdBytes: 64 * 1024,
  massiveWriteThresholdBytes: 128 * 1024 * 1024,
  forcedHeavyWritePatterns: [/^blob\.heavy-override/],
  forcedUltraLightWritePatterns: [/^blob\.micro(?:\.|$)/],
  forcedMassiveWritePatterns: [/^blob\.massive-override/]
});
assert.deepEqual(
  laneSplit.massive.map((entry) => entry.label),
  ['blob.massive-override.json', 'blob.massive-size.json'],
  'expected forced-massive and size-massive entries to land in massive lane deterministically'
);
assert.deepEqual(
  laneSplit.heavy.map((entry) => entry.label),
  ['blob.heavy-override.json', 'blob.micro.override.json'],
  'expected heavy lane to retain precedence over ultra-light hints when thresholds conflict'
);
assert.deepEqual(
  laneSplit.ultraLight.map((entry) => entry.label),
  ['blob.micro.meta.json'],
  'expected only non-heavy micro entries to remain in ultra-light lane'
);
assert.deepEqual(
  laneSplit.light.map((entry) => entry.label),
  ['blob.regular-a.json'],
  'expected unmatched medium entries to remain in light lane'
);

console.log('artifact write lane planning test passed');
