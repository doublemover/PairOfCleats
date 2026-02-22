#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildFileProgressHeartbeatText } from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const heartbeatLine = buildFileProgressHeartbeatText({
  count: 20,
  total: 100,
  startedAtMs: 10_000,
  nowMs: 20_000,
  inFlight: 5,
  trackedSubprocesses: 2
});

assert.match(
  heartbeatLine,
  /\[watchdog\] progress 20\/100 \(20\.0%\) elapsed=10s rate=2\.00 files\/s eta=40s inFlight=5 trackedSubprocesses=2/,
  'expected heartbeat to include deterministic progress/rate/eta and in-flight telemetry'
);

const zeroProgressLine = buildFileProgressHeartbeatText({
  count: 0,
  total: 100,
  startedAtMs: 10_000,
  nowMs: 20_000,
  inFlight: 0,
  trackedSubprocesses: 0
});

assert.match(
  zeroProgressLine,
  /elapsed=10s rate=0\.00 files\/s eta=n\/a inFlight=0 trackedSubprocesses=0/,
  'expected heartbeat to emit n/a ETA when no files have completed'
);

console.log('process-files progress heartbeat test passed');
