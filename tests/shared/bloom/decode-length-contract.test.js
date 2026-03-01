#!/usr/bin/env node
import assert from 'node:assert/strict';
import { BloomFilter, decodeBloomFilter, encodeBloomFilter } from '../../../src/shared/bloom.js';

const filter = new BloomFilter({ bits: 256, hashes: 3 });
filter.add('alpha');

const encoded = encodeBloomFilter(filter);
const restored = decodeBloomFilter(encoded);
assert.ok(restored, 'expected valid bloom payload to decode');
assert.equal(restored.has('alpha'), true, 'expected decoded bloom to contain inserted value');

const decodedBytes = Buffer.from(encoded.bytes, 'base64');

const shortPayload = {
  ...encoded,
  bytes: decodedBytes.subarray(0, decodedBytes.length - 1).toString('base64')
};
assert.equal(
  decodeBloomFilter(shortPayload),
  null,
  'expected short bloom payload to be rejected'
);

const longPayload = {
  ...encoded,
  bytes: Buffer.concat([decodedBytes, Buffer.from([0])]).toString('base64')
};
assert.equal(
  decodeBloomFilter(longPayload),
  null,
  'expected oversized bloom payload to be rejected'
);

console.log('bloom decode length contract test passed');
