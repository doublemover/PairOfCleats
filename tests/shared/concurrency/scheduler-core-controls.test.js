#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  applySchedulerTelemetryOptions,
  applySchedulerTokenLimits
} from '../../../src/shared/concurrency/scheduler-core-controls.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tokenState = {
  cpu: { total: 2 },
  io: { total: 3 },
  mem: { total: 4 }
};
const tokenLimits = applySchedulerTokenLimits({
  limits: {
    cpuTokens: 8.9,
    ioTokens: 0,
    memoryTokens: 5
  },
  cpuTokens: 2,
  ioTokens: 3,
  memoryTokens: 4,
  tokens: tokenState
});
assert.deepEqual(tokenLimits, {
  cpuTokens: 8,
  ioTokens: 1,
  memoryTokens: 5
});
assert.equal(tokenState.cpu.total, 8);
assert.equal(tokenState.io.total, 1);
assert.equal(tokenState.mem.total, 5);

const telemetryOptions = applySchedulerTelemetryOptions({
  options: {
    stage: 'stage2_write',
    queueDepthSnapshotsEnabled: false,
    traceIntervalMs: 50,
    queueDepthSnapshotIntervalMs: 500
  },
  telemetryStage: 'default',
  normalizeTelemetryStage: (stage, fallback) => `${fallback}:${stage}`,
  queueDepthSnapshotsEnabled: true,
  traceIntervalMs: 1000,
  queueDepthSnapshotIntervalMs: 5000
});
assert.deepEqual(telemetryOptions, {
  telemetryStage: 'default:stage2_write',
  queueDepthSnapshotsEnabled: false,
  traceIntervalMs: 100,
  queueDepthSnapshotIntervalMs: 1000
});

console.log('scheduler core controls helper test passed');
