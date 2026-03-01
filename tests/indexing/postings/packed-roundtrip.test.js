#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  decodePackedOffsets,
  encodePackedOffsets,
  packTfPostings,
  unpackTfPostings
} from '../../../src/shared/packed-postings.js';

const postings = [
  [
    [1, 2],
    [5, 1],
    [9, 3]
  ],
  [],
  [
    [10, 1]
  ],
  [
    [2, 2],
    [130, 1],
    [260, 5]
  ]
];

const packed = packTfPostings(postings, { blockSize: 2 });
const offsetsBuffer = encodePackedOffsets(packed.offsets);
const offsets = decodePackedOffsets(offsetsBuffer);

assert.equal(offsets.length, postings.length + 1);
assert.deepEqual(offsets, packed.offsets);

const decoded = unpackTfPostings(packed.buffer, offsets, { blockSize: packed.blockSize });
assert.deepEqual(decoded, postings);

console.log('packed postings roundtrip test passed');
