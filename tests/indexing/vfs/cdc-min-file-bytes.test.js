#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCdcSegments } from '../../../src/index/segments/cdc.js';

const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi';
const segments = buildCdcSegments({
  text,
  languageId: 'markdown',
  options: {
    minBytes: 4,
    avgBytes: 8,
    maxBytes: 16,
    windowBytes: 4,
    maskBits: 1,
    minFileBytes: 1024
  }
});

assert.equal(segments.length, 1, 'expected one segment when file is below minFileBytes');
assert.equal(segments[0].start, 0);
assert.equal(segments[0].end, text.length);
assert.equal(
  segments[0]?.meta?.cdc?.bypassedByMinFileBytes,
  true,
  'expected minFileBytes bypass marker'
);

console.log('VFS CDC minFileBytes bypass test passed');
