#!/usr/bin/env node
import assert from 'node:assert/strict';
import { unpackUint32 } from '../../../src/retrieval/sqlite-helpers.js';

const expected = [1, 65535, 4294967295];
const packed = Buffer.from(new Uint32Array(expected).buffer);

const aligned = unpackUint32(packed);
assert.deepEqual(aligned, expected, 'expected aligned buffer decode');

const misalignedSource = Buffer.concat([Buffer.from([0]), packed]);
const misalignedSlice = misalignedSource.subarray(1);
const misaligned = unpackUint32(misalignedSlice);
assert.deepEqual(misaligned, expected, 'expected unaligned buffer decode via safe path');

const withTrailingByte = Buffer.concat([packed, Buffer.from([9])]);
const trailing = unpackUint32(withTrailingByte);
assert.deepEqual(trailing, expected, 'expected trailing bytes to be ignored');

console.log('unpackUint32 buffer alignment test passed');
