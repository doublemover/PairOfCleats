#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { drainArtifactWriteQueues } from '../../../src/index/build/artifacts/write-execution.js';

applyTestEnv({ testing: '1' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const neverSettles = new Promise(() => {});

const laneWrites = {
  ultraLight: [
    {
      label: 'fail-fast.json',
      estimatedBytes: 1,
      enqueuedAt: Date.now() - 5,
      job: async () => {
        await sleep(5);
        throw new Error('boom');
      }
    },
    {
      label: 'hung.json',
      estimatedBytes: 1,
      enqueuedAt: Date.now() - 5,
      job: () => neverSettles
    }
  ],
  massive: [],
  light: [],
  heavy: []
};

const activeWrites = new Map();
const activeWriteBytes = new Map();
const artifactMetrics = new Map();
const artifactQueueDelaySamples = new Map();
const heartbeatCalls = [];
const logLines = [];

const startedAt = Date.now();
let caughtError = null;
try {
  await drainArtifactWriteQueues({
    scheduler: null,
    outDir: process.cwd(),
    laneWrites,
    writeFsStrategy: {
      mode: 'generic',
      microCoalescing: false
    },
    ultraLightWriteThresholdBytes: 16 * 1024,
    writeConcurrency: 2,
    adaptiveWriteConcurrencyEnabled: false,
    writeConcurrencyController: {
      observe: () => 2,
      getCurrentConcurrency: () => 2
    },
    workClassSmallConcurrencyOverride: 2,
    workClassMediumConcurrencyOverride: null,
    workClassLargeConcurrencyOverride: null,
    writeTailRescueEnabled: false,
    writeTailRescueMaxPending: 2,
    writeTailRescueStallSeconds: 30,
    writeTailRescueBoostIoTokens: 0,
    writeTailRescueBoostMemTokens: 0,
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
    updatePieceMetadata: () => {},
    logWriteProgress: () => {},
    artifactMetrics,
    artifactQueueDelaySamples,
    logLine: (line) => logLines.push(String(line || '')),
    fatalWriteDrainTimeoutMs: 30
  });
  assert.fail('expected failing write to throw');
} catch (error) {
  caughtError = error;
}
const elapsedMs = Math.max(0, Date.now() - startedAt);

assert.equal(caughtError?.message, 'boom', 'expected original write error');
assert.ok(elapsedMs >= 30, `expected bounded drain wait before fail-fast, got ${elapsedMs}ms`);
assert.ok(elapsedMs < 400, `expected fatal path to avoid hanging on stuck writes, got ${elapsedMs}ms`);
assert.equal(activeWrites.size, 0, 'expected no active writes after timeout-fail-fast');
assert.equal(activeWriteBytes.size, 0, 'expected no active write bytes after timeout-fail-fast');
assert.deepEqual(heartbeatCalls, ['start', 'stop'], 'expected heartbeat lifecycle around timeout fail-fast');
assert.ok(
  logLines.some((line) => line.includes('write failure drain timeout')),
  'expected timeout warning log when in-flight write does not settle'
);

console.log('artifact write execution failure timeout test passed');
