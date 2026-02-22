#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildWatchdogNearThresholdSummary,
  isNearThresholdSlowFileDuration,
  resolveFileWatchdogConfig
} from '../../../src/index/build/indexer/steps/process-files.js';

assert.equal(
  isNearThresholdSlowFileDuration({ activeDurationMs: 8800, thresholdMs: 10000 }),
  true,
  'expected duration in default near-threshold window to be flagged'
);
assert.equal(
  isNearThresholdSlowFileDuration({ activeDurationMs: 8400, thresholdMs: 10000 }),
  false,
  'expected duration below lower bound to be excluded'
);
assert.equal(
  isNearThresholdSlowFileDuration({ activeDurationMs: 10000, thresholdMs: 10000 }),
  false,
  'expected threshold-hit duration to be treated as slow warning, not near-threshold'
);

const summary = buildWatchdogNearThresholdSummary({
  sampleCount: 40,
  nearThresholdCount: 30,
  slowWarningCount: 4,
  thresholdTotalMs: 400000,
  activeTotalMs: 360000,
  lowerFraction: 0.9,
  upperFraction: 1,
  alertFraction: 0.6,
  minSamples: 20,
  slowFileMs: 10000
});
assert.equal(summary.anomaly, true, 'expected anomaly when ratio exceeds alert threshold with enough samples');
assert.equal(summary.nearThresholdRatio, 0.75);
assert.equal(summary.suggestedSlowFileMs, 12500, 'expected suggested threshold uplift for anomaly');

const noAnomaly = buildWatchdogNearThresholdSummary({
  sampleCount: 5,
  nearThresholdCount: 5,
  alertFraction: 0.5,
  minSamples: 20,
  slowFileMs: 10000
});
assert.equal(noAnomaly.anomaly, false, 'expected min-sample guard to suppress anomalies on tiny samples');
assert.equal(noAnomaly.suggestedSlowFileMs, null);

const watchdogConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: 12000,
      nearThresholdLowerFraction: 0.9,
      nearThresholdUpperFraction: 0.97,
      nearThresholdAlertFraction: 0.7,
      nearThresholdMinSamples: 12
    }
  }
});
assert.equal(watchdogConfig.nearThresholdLowerFraction, 0.9);
assert.equal(watchdogConfig.nearThresholdUpperFraction, 0.97);
assert.equal(watchdogConfig.nearThresholdAlertFraction, 0.7);
assert.equal(watchdogConfig.nearThresholdMinSamples, 12);

console.log('watchdog near-threshold anomaly test passed');
