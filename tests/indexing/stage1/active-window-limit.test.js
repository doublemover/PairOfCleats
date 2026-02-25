#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildContiguousSeqWindows,
  resolveActiveSeqWindows
} from '../../../src/index/build/indexer/steps/process-files/ordering.js';

ensureTestingEnv(process.env);

const entries = Array.from({ length: 20 }, (_unused, index) => ({
  orderIndex: index,
  costMs: 1,
  bytes: 1
}));

const windows = buildContiguousSeqWindows(entries, {
  config: {
    targetWindowCost: 2,
    maxWindowCost: 2,
    maxWindowBytes: 1000,
    maxInFlightSeqSpan: 100,
    minWindowEntries: 1,
    maxWindowEntries: 2,
    adaptive: false
  }
});

assert.ok(windows.length >= 8, 'expected many small windows in fixture');

const activeAtStart = resolveActiveSeqWindows(windows, 0, { maxActiveWindows: 4 });
assert.equal(activeAtStart.length, 4, 'expected active window resolver to allow more than two windows');
assert.deepEqual(
  activeAtStart.map((window) => window.windowId),
  [0, 1, 2, 3],
  'expected first four windows to be active at start cursor'
);
const activeAtWideLimit = resolveActiveSeqWindows(windows, 0, { maxActiveWindows: 16 });
assert.equal(activeAtWideLimit.length, windows.length, 'expected resolver to support active limits above eight');

console.log('stage1 active window limit test passed');
