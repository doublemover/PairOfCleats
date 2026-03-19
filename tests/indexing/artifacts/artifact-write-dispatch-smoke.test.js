#!/usr/bin/env node
import assert from 'node:assert/strict';

import { dispatchArtifactWrites } from '../../../src/index/build/artifacts/write-dispatch.js';

const progressOrder = [];
const pieceMetadata = [];
const artifactMetrics = new Map();
const artifactQueueDelaySamples = new Map();
const activeWrites = new Map();
const activeWriteBytes = new Map();
const activeWriteMeta = new Map();
const hugeWriteState = { bytes: 0, families: new Set() };

await dispatchArtifactWrites({
  laneQueues: {
    ultraLight: [{
      label: 'meta.json',
      estimatedBytes: 4096,
      enqueuedAt: Date.now(),
      job: async () => ({
        bytes: 11,
        checksum: 'abc',
        checksumAlgo: 'sha1'
      })
    }],
    massive: [],
    light: [{
      label: 'report.json',
      estimatedBytes: 2 * 1024 * 1024,
      enqueuedAt: Date.now(),
      job: async () => ({
        bytes: 22,
        checksum: 'def',
        checksumAlgo: 'sha1'
      })
    }],
    heavy: []
  },
  writeFsStrategy: {
    mode: 'generic',
    microCoalescing: true,
    microBatchMaxCount: 4,
    microBatchMaxBytes: 64 * 1024
  },
  ultraLightWriteThresholdBytes: 64 * 1024,
  writeTailWorkerEnabled: false,
  writeTailWorkerMaxPending: 3,
  writeTailRescueEnabled: false,
  writeTailRescueMaxPending: 3,
  writeTailRescueStallSeconds: 15,
  writeTailRescueBoostIoTokens: 1,
  writeTailRescueBoostMemTokens: 1,
  adaptiveWriteConcurrencyEnabled: false,
  adaptiveWriteObserveIntervalMs: 0,
  adaptiveWriteQueuePendingThreshold: 1,
  adaptiveWriteQueueOldestWaitMsThreshold: 1200,
  adaptiveWriteQueueWaitP95MsThreshold: 750,
  adaptiveWriteStallScaleDownSeconds: 20,
  writeConcurrencyController: {
    getCurrentConcurrency: () => 1,
    observe: () => 1
  },
  writeConcurrency: 1,
  workClassSmallConcurrencyOverride: null,
  workClassMediumConcurrencyOverride: null,
  workClassLargeConcurrencyOverride: null,
  hostConcurrency: 4,
  scheduler: null,
  effectiveAbortSignal: null,
  canDispatchEntryUnderHugeWritePolicy: () => true,
  activeWrites,
  activeWriteBytes,
  activeWriteMeta,
  hugeWriteState,
  updateWriteInFlightTelemetry: () => {},
  getLongestWriteStallSeconds: () => 0,
  getActiveWriteTelemetrySnapshot: () => ({ inflight: [], previewText: '', phaseSummaryText: '' }),
  updateActiveWriteMeta: (label, patch) => {
    activeWriteMeta.set(label, { ...(activeWriteMeta.get(label) || {}), ...patch });
  },
  resolveEntryEstimatedBytes: (entry) => Number(entry?.estimatedBytes) || 0,
  resolveHugeWriteFamily: () => null,
  massiveWriteIoTokens: 2,
  massiveWriteMemTokens: 1,
  resolveArtifactWriteMemTokens: () => 0,
  outDir: process.cwd(),
  artifactMetrics,
  artifactQueueDelaySamples,
  updatePieceMetadata: (label, meta) => {
    pieceMetadata.push({ label, meta });
  },
  formatBytes: (value) => String(value),
  logLine: () => {},
  logWriteProgress: (label) => {
    progressOrder.push(label);
  },
  writeHeartbeat: {
    start() {},
    stop() {},
    clearLabelAlerts() {}
  }
});

assert.deepEqual(
  progressOrder,
  ['meta.json', 'report.json'],
  'expected dispatcher to drain ultra-light work before regular light work under single-slot concurrency'
);
assert.equal(artifactMetrics.size, 2, 'expected per-artifact telemetry rows to be recorded');
assert.deepEqual(
  pieceMetadata.map((entry) => entry.label),
  ['meta.json', 'report.json'],
  'expected dispatcher to attach piece metadata updates for each completed artifact'
);
assert.equal(activeWrites.size, 0, 'expected active write tracking to drain after dispatch');
assert.equal(hugeWriteState.bytes, 0, 'expected huge write runtime state to clear after dispatch');

console.log('artifact write dispatch smoke test passed');
