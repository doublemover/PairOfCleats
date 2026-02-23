#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const scheduler = createBuildScheduler({
  enabled: true,
  adaptive: true,
  cpuTokens: 2,
  ioTokens: 2,
  memoryTokens: 2,
  adaptiveSurfaces: {
    fdPressure: {
      highPressureThreshold: 0.31
    },
    surfaces: {
      parse: {
        ioPressureThreshold: 0.9,
        fdPressureThreshold: 0.27
      }
    }
  }
});

try {
  const stats = scheduler.stats();
  const parseThresholds = stats?.adaptive?.surfaces?.parse?.thresholds || null;
  const embeddingsThresholds = stats?.adaptive?.surfaces?.embeddings?.thresholds || null;
  assert.ok(parseThresholds, 'expected parse surface thresholds in scheduler stats');
  assert.ok(embeddingsThresholds, 'expected embeddings surface thresholds in scheduler stats');
  assert.equal(parseThresholds.ioPressure, 0.9, 'expected parse io pressure threshold override');
  assert.equal(parseThresholds.fdPressure, 0.27, 'expected parse fd pressure threshold override');
  assert.equal(
    embeddingsThresholds.fdPressure,
    0.31,
    'expected global fd pressure threshold to apply to non-overridden surfaces'
  );
} finally {
  scheduler.shutdown();
}

console.log('scheduler fd pressure threshold compatibility test passed');
