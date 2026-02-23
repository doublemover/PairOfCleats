#!/usr/bin/env node
import assert from 'node:assert/strict';

import { drainArtifactWriteQueues } from '../../../src/index/build/artifacts/write-execution.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createWriteEntry = ({ label, estimatedBytes, delayMs = 0, startOrder }) => ({
  label,
  estimatedBytes,
  enqueuedAt: Date.now() - 5,
  job: async () => {
    startOrder.push(label);
    if (delayMs > 0) await sleep(delayMs);
    return {
      bytes: estimatedBytes,
      checksumAlgo: 'sha1',
      checksum: `c-${label}`
    };
  }
});

const startOrder = [];
const laneWrites = {
  ultraLight: [
    createWriteEntry({
      label: 'meta-a.json',
      estimatedBytes: 8 * 1024,
      delayMs: 25,
      startOrder
    }),
    createWriteEntry({
      label: 'meta-b.json',
      estimatedBytes: 10 * 1024,
      delayMs: 1,
      startOrder
    })
  ],
  massive: [
    createWriteEntry({
      label: 'massive-a.bin',
      estimatedBytes: 2 * 1024 * 1024,
      delayMs: 10,
      startOrder
    })
  ],
  light: [
    createWriteEntry({
      label: 'light-a.json',
      estimatedBytes: 96 * 1024,
      delayMs: 1,
      startOrder
    })
  ],
  heavy: []
};

const activeWrites = new Map();
const activeWriteBytes = new Map();
const artifactMetrics = new Map();
const artifactQueueDelaySamples = new Map();
const pieceMeta = new Map();
const progressLabels = [];
const heartbeatCalls = [];

await drainArtifactWriteQueues({
  scheduler: null,
  outDir: process.cwd(),
  laneWrites,
  writeFsStrategy: {
    mode: 'generic',
    microCoalescing: true,
    microBatchMaxCount: 4,
    microBatchMaxBytes: 40 * 1024
  },
  ultraLightWriteThresholdBytes: 16 * 1024,
  writeConcurrency: 2,
  adaptiveWriteConcurrencyEnabled: false,
  writeConcurrencyController: {
    observe: () => 2,
    getCurrentConcurrency: () => 2
  },
  workClassSmallConcurrencyOverride: 1,
  workClassMediumConcurrencyOverride: null,
  workClassLargeConcurrencyOverride: 1,
  writeTailRescueEnabled: true,
  writeTailRescueMaxPending: 2,
  writeTailRescueStallSeconds: 30,
  writeTailRescueBoostIoTokens: 1,
  writeTailRescueBoostMemTokens: 1,
  writeTailWorkerEnabled: false,
  writeTailWorkerMaxPending: 3,
  massiveWriteIoTokens: 2,
  massiveWriteMemTokens: 2,
  resolveArtifactWriteMemTokens: () => 0,
  getLongestWriteStallSeconds: () => 0,
  activeWrites,
  activeWriteBytes,
  writeHeartbeat: {
    start: () => heartbeatCalls.push('start'),
    stop: () => heartbeatCalls.push('stop'),
    clearLabelAlerts: () => {}
  },
  updateWriteInFlightTelemetry: () => {},
  updatePieceMetadata: (piecePath, meta = {}) => {
    pieceMeta.set(piecePath, meta);
  },
  logWriteProgress: (label) => {
    progressLabels.push(label);
  },
  artifactMetrics,
  artifactQueueDelaySamples,
  logLine: () => {}
});

assert.deepEqual(
  startOrder.slice(0, 2),
  ['meta-a.json', 'massive-a.bin'],
  'expected first dispatch cycle to run ultra-light then massive lane before light lane'
);

assert.equal(artifactMetrics.size, 4, 'expected one metric row per write');
assert.equal(artifactQueueDelaySamples.size, 4, 'expected queue-delay samples recorded per write');
assert.equal(progressLabels.length, 4, 'expected write progress callback to run for every completed write');

const firstBatchMetric = artifactMetrics.get('meta-a.json');
const secondBatchMetric = artifactMetrics.get('meta-b.json');
assert.equal(firstBatchMetric?.batchSize, 2, 'expected ultra-light coalesced batch size metadata');
assert.equal(firstBatchMetric?.batchIndex, 1, 'expected first coalesced entry batch index');
assert.equal(secondBatchMetric?.batchSize, 2, 'expected second coalesced entry to preserve batch size');
assert.equal(secondBatchMetric?.batchIndex, 2, 'expected second coalesced entry batch index');

assert.equal(artifactMetrics.get('massive-a.bin')?.lane, 'massive', 'expected massive lane attribution');
assert.equal(artifactMetrics.get('light-a.json')?.lane, 'light', 'expected light lane attribution');

assert.ok(Number.isFinite(pieceMeta.get('meta-a.json')?.bytes), 'expected piece metadata update for first entry');
assert.ok(Number.isFinite(pieceMeta.get('meta-b.json')?.bytes), 'expected piece metadata update for second entry');
assert.ok(Number.isFinite(pieceMeta.get('massive-a.bin')?.bytes), 'expected piece metadata update for massive entry');
assert.ok(Number.isFinite(pieceMeta.get('light-a.json')?.bytes), 'expected piece metadata update for light entry');

assert.equal(activeWrites.size, 0, 'expected no active writes left after drain');
assert.equal(activeWriteBytes.size, 0, 'expected active write bytes map cleared after drain');
assert.deepEqual(heartbeatCalls, ['start', 'stop'], 'expected heartbeat lifecycle around drain');

console.log('artifact write execution dispatch test passed');
