#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  dispatchScheduledArtifactWrites,
  resolveAdaptiveWriteInitialConcurrency
} from '../../../src/index/build/artifacts/write-dispatch.js';

applyTestEnv({ testing: '1' });

assert.equal(
  resolveAdaptiveWriteInitialConcurrency({
    adaptiveWriteConcurrencyEnabled: false,
    writeConcurrency: 7,
    adaptiveWriteMinConcurrency: 2,
    adaptiveWriteStartConcurrencyOverride: null,
    writeConcurrencyOverride: false
  }),
  7,
  'expected adaptive disabled mode to keep full write concurrency'
);

assert.equal(
  resolveAdaptiveWriteInitialConcurrency({
    adaptiveWriteConcurrencyEnabled: true,
    writeConcurrency: 10,
    adaptiveWriteMinConcurrency: 3,
    adaptiveWriteStartConcurrencyOverride: 4,
    writeConcurrencyOverride: false
  }),
  4,
  'expected explicit adaptive start override to win'
);

assert.equal(
  resolveAdaptiveWriteInitialConcurrency({
    adaptiveWriteConcurrencyEnabled: true,
    writeConcurrency: 9,
    adaptiveWriteMinConcurrency: 2,
    adaptiveWriteStartConcurrencyOverride: null,
    writeConcurrencyOverride: true
  }),
  9,
  'expected writeConcurrency override to start adaptive controller at full cap'
);

assert.equal(
  resolveAdaptiveWriteInitialConcurrency({
    adaptiveWriteConcurrencyEnabled: true,
    writeConcurrency: 5,
    adaptiveWriteMinConcurrency: 4,
    adaptiveWriteStartConcurrencyOverride: null,
    writeConcurrencyOverride: false
  }),
  4,
  'expected default adaptive start to respect min concurrency floor'
);

const dispatchLogs = [];
const controllerInputs = [];
const drainedCalls = [];

const dispatchResult = await dispatchScheduledArtifactWrites({
  writes: [{ label: 'a.json' }, { label: 'b.json' }],
  artifactConfig: {},
  heavyWriteThresholdBytes: 1024,
  ultraLightWriteThresholdBytes: 64,
  massiveWriteThresholdBytes: 4096,
  forcedHeavyWritePatterns: [],
  forcedUltraLightWritePatterns: [],
  forcedMassiveWritePatterns: [],
  adaptiveWriteConcurrencyEnabled: true,
  adaptiveWriteMinConcurrency: 1,
  adaptiveWriteStartConcurrencyOverride: null,
  adaptiveWriteScaleUpBacklogPerSlot: 1.5,
  adaptiveWriteScaleDownBacklogPerSlot: 0.5,
  adaptiveWriteStallScaleDownSeconds: 10,
  adaptiveWriteStallScaleUpGuardSeconds: 5,
  adaptiveWriteScaleUpCooldownMs: 0,
  adaptiveWriteScaleDownCooldownMs: 0,
  scheduler: null,
  outDir: process.cwd(),
  writeFsStrategy: { mode: 'generic' },
  workClassSmallConcurrencyOverride: null,
  workClassMediumConcurrencyOverride: null,
  workClassLargeConcurrencyOverride: null,
  writeTailRescueEnabled: false,
  writeTailRescueMaxPending: 0,
  writeTailRescueStallSeconds: 0,
  writeTailRescueBoostIoTokens: 0,
  writeTailRescueBoostMemTokens: 0,
  writeTailWorkerEnabled: false,
  writeTailWorkerMaxPending: 0,
  massiveWriteIoTokens: 2,
  massiveWriteMemTokens: 2,
  resolveArtifactWriteMemTokens: () => 0,
  getLongestWriteStallSeconds: () => 0,
  activeWrites: new Map(),
  activeWriteBytes: new Map(),
  writeHeartbeat: {
    start: () => {},
    stop: () => {},
    clearLabelAlerts: () => {}
  },
  updateWriteInFlightTelemetry: () => {},
  updatePieceMetadata: () => {},
  logWriteProgress: () => {},
  artifactMetrics: new Map(),
  artifactQueueDelaySamples: new Map(),
  logLine: (message) => dispatchLogs.push(message),
  splitLanes: () => ({
    ultraLight: [{ label: 'a.json' }],
    massive: [],
    light: [{ label: 'b.json' }],
    heavy: []
  }),
  resolveWriteConcurrency: () => ({ cap: 8, override: false }),
  createWriteConcurrencyController: (input) => {
    controllerInputs.push(input);
    return {
      observe: () => 2,
      getCurrentConcurrency: () => 2
    };
  },
  drainWrites: async (input) => {
    drainedCalls.push(input);
  }
});

assert.equal(dispatchResult.totalWrites, 2, 'expected total writes to reflect planned lane entries');
assert.equal(dispatchResult.writeConcurrency, 2, 'expected write concurrency to clamp by total writes');
assert.equal(controllerInputs.length, 1, 'expected one adaptive controller to be created');
assert.equal(controllerInputs[0].initialConcurrency, 2, 'expected default adaptive start to use 60% cap rounded up');
assert.equal(drainedCalls.length, 1, 'expected dispatch to drain writes when work is present');
assert.equal(drainedCalls[0].laneWrites.ultraLight.length, 1, 'expected ultra-light lane payload to pass through');
assert.equal(drainedCalls[0].laneWrites.light.length, 1, 'expected light lane payload to pass through');
assert.equal(dispatchLogs[0], 'Writing index files (2 artifacts)...', 'expected non-empty write status log');
assert.equal(dispatchLogs.at(-1), '', 'expected trailing status spacer log');

const emptyLogs = [];
let emptyDrainCalls = 0;
const emptyResult = await dispatchScheduledArtifactWrites({
  writes: [],
  artifactConfig: {},
  heavyWriteThresholdBytes: 1024,
  ultraLightWriteThresholdBytes: 64,
  massiveWriteThresholdBytes: 4096,
  forcedHeavyWritePatterns: [],
  forcedUltraLightWritePatterns: [],
  forcedMassiveWritePatterns: [],
  adaptiveWriteConcurrencyEnabled: true,
  adaptiveWriteMinConcurrency: 1,
  adaptiveWriteStartConcurrencyOverride: null,
  adaptiveWriteScaleUpBacklogPerSlot: 1.5,
  adaptiveWriteScaleDownBacklogPerSlot: 0.5,
  adaptiveWriteStallScaleDownSeconds: 10,
  adaptiveWriteStallScaleUpGuardSeconds: 5,
  adaptiveWriteScaleUpCooldownMs: 0,
  adaptiveWriteScaleDownCooldownMs: 0,
  scheduler: null,
  outDir: process.cwd(),
  writeFsStrategy: { mode: 'generic' },
  workClassSmallConcurrencyOverride: null,
  workClassMediumConcurrencyOverride: null,
  workClassLargeConcurrencyOverride: null,
  writeTailRescueEnabled: false,
  writeTailRescueMaxPending: 0,
  writeTailRescueStallSeconds: 0,
  writeTailRescueBoostIoTokens: 0,
  writeTailRescueBoostMemTokens: 0,
  writeTailWorkerEnabled: false,
  writeTailWorkerMaxPending: 0,
  massiveWriteIoTokens: 2,
  massiveWriteMemTokens: 2,
  resolveArtifactWriteMemTokens: () => 0,
  getLongestWriteStallSeconds: () => 0,
  activeWrites: new Map(),
  activeWriteBytes: new Map(),
  writeHeartbeat: {
    start: () => {},
    stop: () => {},
    clearLabelAlerts: () => {}
  },
  updateWriteInFlightTelemetry: () => {},
  updatePieceMetadata: () => {},
  logWriteProgress: () => {},
  artifactMetrics: new Map(),
  artifactQueueDelaySamples: new Map(),
  logLine: (message) => emptyLogs.push(message),
  splitLanes: () => ({
    ultraLight: [],
    massive: [],
    light: [],
    heavy: []
  }),
  drainWrites: async () => {
    emptyDrainCalls += 1;
  }
});

assert.equal(emptyResult.totalWrites, 0, 'expected no-write dispatch result to report zero writes');
assert.equal(emptyResult.writeConcurrency, 0, 'expected no-write dispatch result to disable concurrency');
assert.equal(emptyDrainCalls, 0, 'expected no-write dispatch to skip drain');
assert.deepEqual(
  emptyLogs,
  ['Writing index files (0 artifacts)...', ''],
  'expected deterministic zero-artifact status logging'
);

console.log('artifact write dispatch helper test passed');
