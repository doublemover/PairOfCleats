#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildContiguousSeqWindows } from '../../../src/index/build/indexer/steps/process-files/ordering.js';

ensureTestingEnv(process.env);

const summarize = (windows) => windows.map((window) => ({
  id: window.windowId,
  start: window.startSeq,
  end: window.endSeq,
  span: window.seqSpan,
  count: window.entryCount
}));

const entries = Array.from({ length: 12 }, (_unused, index) => ({
  rel: `src/file-${index}.js`,
  orderIndex: index,
  costMs: 10,
  bytes: 32
}));

const config = {
  targetWindowCost: 30,
  maxWindowCost: 50,
  maxWindowBytes: 200,
  maxInFlightSeqSpan: 8,
  minWindowEntries: 1,
  maxWindowEntries: 4,
  adaptive: false
};

const windowsA = buildContiguousSeqWindows(entries, { config });
const windowsB = buildContiguousSeqWindows(entries, { config });

assert.deepEqual(summarize(windowsA), summarize(windowsB), 'expected deterministic planner output');
assert.ok(windowsA.length >= 3, 'expected multi-window split under configured cost caps');

for (let i = 0; i < windowsA.length; i += 1) {
  const window = windowsA[i];
  assert.equal(window.seqSpan, (window.endSeq - window.startSeq) + 1, 'expected seq span to be contiguous');
  if (i > 0) {
    assert.equal(
      windowsA[i - 1].endSeq + 1,
      window.startSeq,
      'expected adjacent windows to partition contiguous seq ranges without overlap'
    );
  }
}

const gappyEntries = [
  { orderIndex: 0, costMs: 1, bytes: 1 },
  { orderIndex: 2, costMs: 1, bytes: 1 },
  { orderIndex: 3, costMs: 1, bytes: 1 }
];
const gappyWindows = buildContiguousSeqWindows(gappyEntries, {
  config: {
    targetWindowCost: 100,
    maxWindowCost: 100,
    maxWindowBytes: 100,
    maxInFlightSeqSpan: 100,
    minWindowEntries: 1,
    maxWindowEntries: 10,
    adaptive: false
  }
});
assert.deepEqual(
  gappyWindows.map((window) => [window.startSeq, window.endSeq]),
  [[0, 0], [2, 3]],
  'expected planner to hard-split on discontiguous seq gaps'
);

console.log('stage1 window planner contiguous ranges test passed');
