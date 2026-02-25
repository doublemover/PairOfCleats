#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildContiguousSeqWindows } from '../../../src/index/build/indexer/steps/process-files/ordering.js';

ensureTestingEnv(process.env);

const entries = Array.from({ length: 24 }, (_unused, index) => ({
  rel: `src/adaptive-${index}.js`,
  orderIndex: index,
  costMs: 10,
  bytes: 16
}));

const config = {
  targetWindowCost: 60,
  maxWindowCost: 120,
  maxWindowBytes: 1024,
  maxInFlightSeqSpan: 64,
  minWindowEntries: 1,
  maxWindowEntries: 12,
  adaptive: true,
  adaptiveShrinkFactor: 0.5,
  adaptiveGrowFactor: 1.5,
  commitLagSoft: 8,
  bufferedBytesSoft: 256
};

const baseline = buildContiguousSeqWindows(entries, { config });
const shrink = buildContiguousSeqWindows(entries, {
  config,
  telemetrySnapshot: {
    commitLag: 50,
    bufferedBytes: 500,
    computeUtilization: 0.9
  }
});
const grow = buildContiguousSeqWindows(entries, {
  config,
  telemetrySnapshot: {
    commitLag: 0,
    bufferedBytes: 0,
    computeUtilization: 0.25
  }
});
const growRepeat = buildContiguousSeqWindows(entries, {
  config,
  telemetrySnapshot: {
    commitLag: 0,
    bufferedBytes: 0,
    computeUtilization: 0.25
  }
});

assert.ok(shrink.length >= baseline.length, 'expected adaptive shrink to increase/sustain window count');
assert.ok(grow.length <= baseline.length, 'expected adaptive grow to decrease/sustain window count');
assert.deepEqual(
  grow.map((window) => [window.startSeq, window.endSeq, window.entryCount]),
  growRepeat.map((window) => [window.startSeq, window.endSeq, window.entryCount]),
  'expected deterministic adaptive output for fixed telemetry snapshots'
);

console.log('stage1 window planner adaptive resize test passed');
