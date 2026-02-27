#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as mod from '../../../src/index/segments/cdc.js';
const segmentWithCdc = mod.segmentWithCdc || mod.buildCdcSegments;
assert.equal(typeof segmentWithCdc, 'function', 'Expected segmentWithCdc export.');

assert.equal(mod.CDC_SEGMENTATION_VERSION, '1.0.0', 'Expected CDC segmentation version 1.0.0.');

const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega';
const segments = await segmentWithCdc({
  text,
  options: {
    minBytes: 16,
    avgBytes: 32,
    maxBytes: 64,
    windowBytes: 16,
    maskBits: 4
  }
});

assert.ok(Array.isArray(segments) && segments.length > 0, 'Expected CDC segmentation to return segments.');

let cursor = 0;
for (const segment of segments) {
  assert.equal(segment.start, cursor, 'Segments should be contiguous.');
  assert.ok(segment.end > segment.start, 'Segments should have non-zero length.');
  assert.ok(typeof segment.segmentUid === 'string' && segment.segmentUid.length > 0, 'Expected segmentUid for CDC segment.');
  cursor = segment.end;
}

assert.equal(cursor, text.length, 'Segments should cover the full text.');

console.log('VFS CDC segmentation contract ok.');
