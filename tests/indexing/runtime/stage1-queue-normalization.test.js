#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildStage1SubprocessOwnershipPrefix,
  resolveStage1Queues
} from '../../../src/index/build/runtime/queues.js';

const stage1Queues = resolveStage1Queues({
  stage1: {
    tokenize: {
      concurrency: 4.9,
      maxPending: 0
    },
    postings: {
      concurrency: 7.2,
      maxPendingRows: '12.8',
      maxPendingBytes: '2048',
      maxHeapFraction: '0.75'
    },
    ordered: {
      maxPending: 10,
      bucketSize: 3.5,
      maxPendingEmergencyFactor: '1.25'
    },
    fileWatchdogMs: '2500',
    fileWatchdogMaxMs: '5000',
    fileWatchdogHardMs: 9000,
    watchdog: {
      bytesPerStep: 4096.4,
      linesPerStep: '120.2',
      stepMs: 300,
      nearThresholdLowerFraction: '0.6',
      nearThresholdUpperFraction: '0.9',
      nearThresholdAlertFraction: '0.95',
      nearThresholdMinSamples: 5.2
    }
  }
});

assert.equal(stage1Queues.tokenize.concurrency, 4, 'expected tokenize concurrency coercion');
assert.equal(stage1Queues.tokenize.maxPending, null, 'expected invalid max pending to normalize to null');
assert.equal(stage1Queues.postings.maxPending, 7, 'expected postings maxPending fallback from concurrency');
assert.equal(stage1Queues.postings.maxPendingRows, 12, 'expected postings rows coercion');
assert.equal(stage1Queues.postings.maxPendingBytes, 2048, 'expected postings bytes coercion');
assert.equal(stage1Queues.postings.maxHeapFraction, 0.75, 'expected postings heap fraction coercion');
assert.equal(stage1Queues.ordered.maxPending, 10, 'expected ordered maxPending coercion');
assert.equal(stage1Queues.ordered.bucketSize, 3, 'expected ordered bucket size coercion');
assert.equal(stage1Queues.ordered.maxPendingEmergencyFactor, 1.25, 'expected ordered emergency factor coercion');
assert.equal(stage1Queues.watchdog.slowFileMs, 2500, 'expected watchdog fallback from legacy slow-file ms');
assert.equal(stage1Queues.watchdog.maxSlowFileMs, 5000, 'expected watchdog fallback from legacy max-slow-file ms');
assert.equal(stage1Queues.watchdog.hardTimeoutMs, 9000, 'expected watchdog fallback from legacy hard-timeout ms');
assert.equal(stage1Queues.watchdog.bytesPerStep, 4096, 'expected watchdog bytes-per-step coercion');
assert.equal(stage1Queues.watchdog.linesPerStep, 120, 'expected watchdog lines-per-step coercion');
assert.equal(stage1Queues.watchdog.stepMs, 300, 'expected watchdog step-ms coercion');
assert.equal(stage1Queues.watchdog.nearThresholdLowerFraction, 0.6, 'expected lower threshold fraction');
assert.equal(stage1Queues.watchdog.nearThresholdUpperFraction, 0.9, 'expected upper threshold fraction');
assert.equal(stage1Queues.watchdog.nearThresholdAlertFraction, 0.95, 'expected alert threshold fraction');
assert.equal(stage1Queues.watchdog.nearThresholdMinSamples, 5, 'expected min sample coercion');

const ownershipPrefix = buildStage1SubprocessOwnershipPrefix({ buildId: 'build-123' });
assert.equal(ownershipPrefix, 'stage1:build-123', 'expected deterministic stage1 ownership prefix');

console.log('stage1 queue normalization test passed');
