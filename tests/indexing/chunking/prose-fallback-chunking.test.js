#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chunkLargeProseFallback } from '../../../src/index/chunking/dispatch/shared.js';

const smallText = 'Small prose section.\nAnother line.';
const smallChunks = chunkLargeProseFallback(smallText, {});
assert.equal(smallChunks.length, 1, 'expected small prose to stay as a single chunk');
assert.equal(smallChunks[0].start, 0, 'expected small prose chunk to start at 0');
assert.equal(smallChunks[0].end, smallText.length, 'expected small prose chunk to end at text length');

const largeText = 'x'.repeat(120);
const chunked = chunkLargeProseFallback(largeText, {
  chunking: {
    proseFallbackMaxChars: 40,
    proseFallbackChunkChars: 25
  }
});
assert.equal(chunked.length, 5, 'expected oversized prose fallback to split into bounded chunks');
assert.deepEqual(
  chunked.map((entry) => [entry.start, entry.end]),
  [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
    [100, 120]
  ],
  'expected prose fallback chunks to be contiguous and cover the full text'
);
assert.ok(chunked.every((entry) => entry.kind === 'Section'), 'expected prose fallback chunks to keep Section kind');

console.log('prose fallback chunking test passed');
