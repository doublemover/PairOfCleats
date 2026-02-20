#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveWorkerResourceLimits } from '../../../src/index/build/workers/config.js';

const originalNodeOptions = process.env.NODE_OPTIONS;

try {
  process.env.NODE_OPTIONS = '--max-old-space-size=4096';

  const targetHonored = resolveWorkerResourceLimits(3, {
    targetPerWorkerMb: 768,
    minPerWorkerMb: 256,
    maxPerWorkerMb: 2048
  });
  assert.equal(
    targetHonored?.maxOldGenerationSizeMb,
    768,
    'expected per-worker target heap to be honored when within budget bounds'
  );

  const targetClampedToBudget = resolveWorkerResourceLimits(3, {
    targetPerWorkerMb: 1600,
    minPerWorkerMb: 256,
    maxPerWorkerMb: 2048
  });
  assert.equal(
    targetClampedToBudget?.maxOldGenerationSizeMb,
    1024,
    'expected per-worker heap to clamp to derived per-worker budget'
  );

  const targetClampedToMin = resolveWorkerResourceLimits(3, {
    targetPerWorkerMb: 700,
    minPerWorkerMb: 900,
    maxPerWorkerMb: 2048
  });
  assert.equal(
    targetClampedToMin?.maxOldGenerationSizeMb,
    900,
    'expected per-worker heap to respect configured minimum bound'
  );
} finally {
  if (originalNodeOptions == null) {
    delete process.env.NODE_OPTIONS;
  } else {
    process.env.NODE_OPTIONS = originalNodeOptions;
  }
}

console.log('worker resource limits target budget test passed');
