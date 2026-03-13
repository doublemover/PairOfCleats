#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveArtifactWriteStallThresholds } from '../../../src/index/build/artifacts/write-telemetry.js';

const baseThresholds = [10, 30, 60];

assert.deepEqual(
  resolveArtifactWriteStallThresholds({
    normalizedWriteStallThresholds: baseThresholds,
    estimatedBytes: 4 * 1024 * 1024
  }),
  baseThresholds,
  'expected small writes to keep baseline stall thresholds'
);

assert.deepEqual(
  resolveArtifactWriteStallThresholds({
    normalizedWriteStallThresholds: baseThresholds,
    estimatedBytes: 256 * 1024 * 1024
  }),
  [15, 45, 90],
  'expected large writes to relax stall thresholds modestly'
);

assert.deepEqual(
  resolveArtifactWriteStallThresholds({
    normalizedWriteStallThresholds: baseThresholds,
    estimatedBytes: 900 * 1024 * 1024
  }),
  [20, 60, 120],
  'expected huge writes to double stall thresholds'
);

console.log('artifact write telemetry thresholds test passed');
