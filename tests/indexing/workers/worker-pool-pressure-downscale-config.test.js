#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';
import { shouldDownscaleWorkersForPressure } from '../../../src/index/build/workers/config.js';

const defaults = normalizeWorkerPoolConfig({
  enabled: true,
  maxWorkers: 10
}, { cpuLimit: 10 });

assert.equal(defaults.autoDownscaleOnPressure, true, 'expected auto pressure downscale to default on');
assert.equal(defaults.downscaleRssThreshold, 0.9, 'expected default RSS downscale threshold');
assert.equal(defaults.downscaleGcThreshold, 0.85, 'expected default GC downscale threshold');
assert.equal(defaults.downscaleMinWorkers, 5, 'expected default minimum workers to track half of maxWorkers');

const custom = normalizeWorkerPoolConfig({
  enabled: true,
  maxWorkers: 8,
  autoDownscaleOnPressure: false,
  downscaleRssThreshold: 0.95,
  downscaleGcThreshold: 0.9,
  downscaleCooldownMs: 42000,
  downscaleMinWorkers: 99
}, { cpuLimit: 8 });

assert.equal(custom.autoDownscaleOnPressure, false, 'expected explicit autoDownscaleOnPressure override');
assert.equal(custom.downscaleRssThreshold, 0.95, 'expected explicit RSS threshold');
assert.equal(custom.downscaleGcThreshold, 0.9, 'expected explicit GC threshold');
assert.equal(custom.downscaleCooldownMs, 42000, 'expected explicit cooldown override');
assert.equal(custom.downscaleMinWorkers, 8, 'expected downscaleMinWorkers clamp to maxWorkers');

assert.equal(
  shouldDownscaleWorkersForPressure({
    rssPressure: 0.93,
    gcPressure: 0.91,
    rssThreshold: 0.9,
    gcThreshold: 0.85
  }),
  true,
  'expected joint RSS+GC threshold breach to trigger downscale eligibility'
);
assert.equal(
  shouldDownscaleWorkersForPressure({
    rssPressure: 0.94,
    gcPressure: 0.72,
    rssThreshold: 0.9,
    gcThreshold: 0.85
  }),
  false,
  'expected GC-only non-breach to keep downscale disabled'
);

console.log('worker pool pressure downscale config test passed');
