#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildContiguousSeqWindows,
  resolveActiveSeqWindows
} from '../../../src/index/build/indexer/steps/process-files/ordering.js';

ensureTestingEnv(process.env);

const entries = Array.from({ length: 12 }, (_unused, index) => ({
  orderIndex: index,
  costMs: 1,
  bytes: 1
}));

const windows = buildContiguousSeqWindows(entries, {
  config: {
    targetWindowCost: 4,
    maxWindowCost: 4,
    maxWindowBytes: 1000,
    maxInFlightSeqSpan: 100,
    minWindowEntries: 1,
    maxWindowEntries: 4,
    adaptive: false
  }
});
assert.equal(windows.length, 3, 'expected deterministic 3-window fixture');

const activeAtStart = resolveActiveSeqWindows(windows, 0, { maxActiveWindows: 2 });
assert.deepEqual(
  activeAtStart.map((window) => window.windowId),
  [0, 1],
  'expected window N + N+1 overlap at start cursor'
);

const activeAtMiddle = resolveActiveSeqWindows(windows, 4, { maxActiveWindows: 2 });
assert.deepEqual(
  activeAtMiddle.map((window) => window.windowId),
  [1, 2],
  'expected overlap to advance one window with commit cursor'
);

const activeAtTail = resolveActiveSeqWindows(windows, 8, { maxActiveWindows: 2 });
assert.deepEqual(
  activeAtTail.map((window) => window.windowId),
  [2],
  'expected single active window at tail once no successor window exists'
);

console.log('stage1 two-window overlap contract test passed');
