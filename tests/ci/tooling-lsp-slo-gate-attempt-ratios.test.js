#!/usr/bin/env node
import assert from 'node:assert/strict';
import { summarizeSampleMetrics } from '../../tools/ci/tooling-lsp-slo-gate.js';

const metrics = summarizeSampleMetrics([
  {
    providerId: 'clangd',
    status: 'ok',
    available: true,
    latencyMs: 25,
    sampled: {
      attemptCount: 3,
      warmupCount: 1,
      timeoutCount: 1,
      fatalFailureCount: 1
    }
  },
  {
    providerId: 'pyright',
    status: 'ok',
    available: true,
    latencyMs: 40,
    sampled: {
      attemptCount: 2,
      warmupCount: 0,
      timeoutCount: 0,
      fatalFailureCount: 0
    }
  }
]);

assert.equal(metrics.requests, 2);
assert.equal(metrics.measuredAttempts, 5);
assert.equal(metrics.measuredWarmups, 1);
assert.equal(metrics.timedOut, 1);
assert.equal(metrics.fatalFailures, 1);
assert.equal(metrics.timeoutRatio, 0.2, 'expected timeout ratio to use measured attempts');
assert.equal(metrics.fatalFailureRate, 0.2, 'expected fatal failure rate to use measured attempts');
assert.equal(metrics.enrichmentCoverage, 1, 'expected enrichment coverage to remain provider-based');
assert.equal(metrics.maxP95MsObserved, 40, 'expected p95 to preserve tail latency among successful samples');

console.log('tooling lsp slo gate attempt ratios test passed');
