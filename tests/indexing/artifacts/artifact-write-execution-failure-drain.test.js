#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { drainArtifactWriteQueues } from '../../../src/index/build/artifacts/write-execution.js';

applyTestEnv({ testing: '1' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const events = [];
const laneWrites = {
  ultraLight: [
    {
      label: 'fail.json',
      estimatedBytes: 1,
      enqueuedAt: Date.now() - 5,
      job: async () => {
        events.push('fail-start');
        await sleep(5);
        events.push('fail-throw');
        throw new Error('boom');
      }
    },
    {
      label: 'slow.json',
      estimatedBytes: 1,
      enqueuedAt: Date.now() - 5,
      job: async () => {
        events.push('slow-start');
        await sleep(120);
        events.push('slow-done');
        return { bytes: 1 };
      }
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
    logWriteProgress: (label) => events.push(`progress:${label}`),
    artifactMetrics,
    artifactQueueDelaySamples,
    logLine: () => {}
  });
  assert.fail('expected failing write to throw');
} catch (error) {
  caughtError = error;
  events.push('caught');
}

assert.equal(caughtError?.message, 'boom', 'expected drain to surface failing write error');
assert.ok(events.includes('slow-done'), 'expected in-flight slow write to settle before returning');
assert.ok(
  events.indexOf('slow-done') < events.indexOf('caught'),
  `expected failure to be raised after in-flight writes settle: ${JSON.stringify(events)}`
);
assert.ok(
  events.indexOf('progress:slow.json') < events.indexOf('caught'),
  `expected slow write completion callbacks to finish before failure is surfaced: ${JSON.stringify(events)}`
);
assert.equal(activeWrites.size, 0, 'expected no active writes after failed drain');
assert.equal(activeWriteBytes.size, 0, 'expected no active write bytes after failed drain');
assert.deepEqual(heartbeatCalls, ['start', 'stop'], 'expected heartbeat lifecycle around failed drain');

console.log('artifact write execution failure drain test passed');
