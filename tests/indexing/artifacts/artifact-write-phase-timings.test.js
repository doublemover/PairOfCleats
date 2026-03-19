#!/usr/bin/env node
import assert from 'node:assert/strict';

import { recordArtifactMetricRow } from '../../../src/index/build/artifacts/write-telemetry.js';

const artifactMetrics = new Map();
const artifactQueueDelaySamples = new Map();

recordArtifactMetricRow({
  label: 'chunk_meta.binary-columnar.bundle',
  metric: {
    queueDelayMs: 5,
    durationMs: 40,
    phaseTimings: {
      serializationMs: 7,
      flushMs: 11,
      fsyncMs: 13,
      publishMs: 17,
      backpressureWaitMs: 19
    }
  },
  artifactMetrics,
  artifactQueueDelaySamples
});

const metric = artifactMetrics.get('chunk_meta.binary-columnar.bundle');
assert.ok(metric, 'expected metric row to be recorded');
assert.ok(metric.phaseTimings && typeof metric.phaseTimings === 'object', 'expected normalized phaseTimings payload');
assert.equal(metric.serializationMs, 7, 'expected serializationMs to flatten from phaseTimings');
assert.equal(metric.flushMs, 11, 'expected flushMs to flatten from phaseTimings');
assert.equal(metric.fsyncMs, 13, 'expected fsyncMs to flatten from phaseTimings');
assert.equal(metric.publishMs, 17, 'expected publishMs to flatten from phaseTimings');
assert.equal(metric.backpressureWaitMs, 19, 'expected backpressureWaitMs to flatten from phaseTimings');
assert.equal(metric.diskMs, 41, 'expected diskMs to derive from flush/fsync/publish timings');

console.log('artifact write phase timings test passed');
