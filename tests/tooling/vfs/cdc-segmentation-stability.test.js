#!/usr/bin/env node
import assert from 'node:assert/strict';
import { segmentWithCdc } from '../../../src/index/segments/cdc.js';

const text = [
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega',
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'
].join('\n');

const options = {
  minBytes: 16,
  avgBytes: 32,
  maxBytes: 64,
  windowBytes: 16,
  maskBits: 4
};

const first = await segmentWithCdc({ text, languageId: 'markdown', options });
const second = await segmentWithCdc({ text, languageId: 'markdown', options });

assert.ok(first.length > 0, 'expected CDC segments');
assert.deepStrictEqual(
  first.map((seg) => [seg.start, seg.end]),
  second.map((seg) => [seg.start, seg.end]),
  'expected deterministic CDC boundaries'
);

let cursor = 0;
for (const segment of first) {
  assert.equal(segment.start, cursor, 'expected contiguous segments');
  assert.ok(segment.end > segment.start, 'expected non-empty segment');
  assert.ok(segment.segmentUid, 'expected segmentUid');
  cursor = segment.end;
}
assert.equal(cursor, text.length, 'expected CDC segments to cover full text');

console.log('VFS CDC segmentation stability ok');
