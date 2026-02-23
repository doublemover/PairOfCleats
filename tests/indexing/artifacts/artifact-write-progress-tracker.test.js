#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { createArtifactWriteProgressTracker } from '../../../src/index/build/artifacts/write-progress.js';

applyTestEnv({ testing: '1' });

const activeWrites = new Map([
  ['a', 1000],
  ['b', 1500]
]);
const activeWriteBytes = new Map([
  ['a', 512],
  ['b', 1024],
  ['ignored-negative', -1],
  ['ignored-nan', Number.NaN]
]);

const progressCalls = [];
const logLines = [];
const inFlightUpdates = [];
let nowMs = 2000;

const tracker = createArtifactWriteProgressTracker({
  telemetry: {
    setInFlightBytes: (scope, payload) => {
      inFlightUpdates.push({ scope, payload });
    }
  },
  activeWrites,
  activeWriteBytes,
  writeProgressMeta: { stage: 'write', mode: 'code' },
  writeLogIntervalMs: 100,
  showProgress: (label, completed, total, meta) => {
    progressCalls.push({ label, completed, total, meta });
  },
  logLine: (line, meta) => {
    logLines.push({ line, meta });
  },
  now: () => nowMs
});

tracker.setTotalWrites(3);
tracker.updateWriteInFlightTelemetry();
assert.deepEqual(inFlightUpdates, [{ scope: 'artifacts.write', payload: { bytes: 1536, count: 2 } }]);

assert.equal(tracker.getLongestWriteStallSeconds(), 1, 'expected longest stall to round from milliseconds to seconds');

tracker.logWriteProgress('a.json');
assert.equal(progressCalls.length, 1);
assert.equal(progressCalls[0].completed, 1);
assert.equal(progressCalls[0].total, 3);
assert.equal(progressCalls[0].meta.message, 'a.json');
assert.equal(logLines.length, 1, 'expected first write to force a status log line');

nowMs = 2050;
tracker.logWriteProgress('b.json');
assert.equal(logLines.length, 1, 'expected interval throttling to suppress intermediate status logs');

nowMs = 2200;
tracker.logWriteProgress('c.json');
assert.equal(logLines.length, 2, 'expected completion write to emit status log line');
assert(
  logLines[1].line.includes('3/3 (100.0%) | c.json'),
  'expected completion status line to include final progress and label'
);

console.log('artifact write progress tracker test passed');
