#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildContiguousSeqWindows
} from '../../../src/index/build/indexer/steps/process-files/ordering.js';
import {
  buildOrderedAppender
} from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const totalFiles = 240;
const entries = Array.from({ length: totalFiles }, (_unused, orderIndex) => ({
  orderIndex,
  costMs: 1 + (orderIndex % 3),
  bytes: 64 + (orderIndex % 11)
}));
const windows = buildContiguousSeqWindows(entries, {
  config: {
    targetWindowCost: 30,
    maxWindowCost: 40,
    maxWindowBytes: 4096,
    maxInFlightSeqSpan: 64,
    minWindowEntries: 1,
    maxWindowEntries: 16,
    adaptive: true,
    adaptiveShrinkFactor: 0.6,
    adaptiveGrowFactor: 1.3,
    commitLagSoft: 24,
    bufferedBytesSoft: 2048
  },
  telemetrySnapshot: {
    commitLag: 8,
    bufferedBytes: 512,
    computeUtilization: 0.7
  }
});

assert.ok(windows.length > 1, 'expected multi-window fixture for throughput bench contract');

const committed = [];
const appender = buildOrderedAppender(
  async (_result, _state, _shardMeta, context = {}) => {
    committed.push(context.orderIndex);
  },
  {},
  {
    expectedCount: totalFiles,
    startIndex: 0,
    maxPendingBeforeBackpressure: 32,
    maxPendingBytes: 256 * 1024
  }
);

const enqueueOrder = entries
  .map((entry) => entry.orderIndex)
  .sort((a, b) => ((a * 29) % totalFiles) - ((b * 29) % totalFiles));

const startedAtMs = Date.now();
await Promise.all(enqueueOrder.map((orderIndex) => appender.enqueue(orderIndex, { orderIndex }, null)));
const elapsedMs = Math.max(1, Date.now() - startedAtMs);
const filesPerSecond = Number(((totalFiles * 1000) / elapsedMs).toFixed(2));

assert.equal(committed.length, totalFiles, 'expected all seq values to commit in bench fixture');
assert.equal(appender.snapshot().nextCommitSeq, totalFiles, 'expected cursor to advance through all files');
assert.ok(filesPerSecond > 0, 'expected positive throughput metric');

console.log(`stage1 windowed throughput bench contract passed (${filesPerSecond} files/s)`);
