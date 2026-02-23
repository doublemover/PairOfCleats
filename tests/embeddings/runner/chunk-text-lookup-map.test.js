#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildChunkTextLookupKey,
  buildChunkTextLookupMap,
  hydrateMissingChunkTextsFromBundle
} from '../../../tools/build/embeddings/runner.js';

const chunks = [
  { id: 7, start: 10, end: 20, chunkId: 'a', text: 'alpha' },
  { id: 8, start: 21, end: 30, chunkId: 'b', text: 'beta' },
  { id: 9, start: 31, end: 40, chunkId: 'c' }
];

const lookup = buildChunkTextLookupMap(chunks);
assert.ok(lookup instanceof Map, 'expected lookup map when chunk texts are present');

const keyA = buildChunkTextLookupKey({ id: 7, start: 10, end: 20, chunkId: 'a' });
const keyB = buildChunkTextLookupKey({ id: 8, start: 21, end: 30, chunkId: 'b' });
const keyMissing = buildChunkTextLookupKey({ id: 9, start: 31, end: 40, chunkId: 'c' });

assert.equal(lookup.get(keyA), 'alpha', 'expected first chunk text lookup hit');
assert.equal(lookup.get(keyB), 'beta', 'expected second chunk text lookup hit');
assert.equal(lookup.has(keyMissing), false, 'expected chunks without inline text to be omitted');

const hydrationItems = [
  { chunk: { id: 1, start: 0, end: 5, chunkId: 'x' } },
  { chunk: { id: 2, start: 5, end: 9, chunkId: 'y' } },
  { chunk: { id: 3, start: 9, end: 14, chunkId: 'z' } }
];
const hydrationTexts = [undefined, undefined, 'already-present'];
const hydrationBundleChunks = [
  { id: 1, start: 0, end: 5, chunkId: 'x', text: 'positional-fill' },
  { id: 9, start: 90, end: 99, chunkId: 'q' },
  { id: 2, start: 5, end: 9, chunkId: 'y', text: 'keyed-fill' }
];
const unresolvedAfterHydration = hydrateMissingChunkTextsFromBundle({
  items: hydrationItems,
  chunkCodeTexts: hydrationTexts,
  bundleChunks: hydrationBundleChunks
});
assert.equal(unresolvedAfterHydration, 0, 'expected positional/keyed hydration to resolve all missing chunk texts');
assert.equal(hydrationTexts[0], 'positional-fill', 'expected positional bundle hydration');
assert.equal(hydrationTexts[1], 'keyed-fill', 'expected keyed bundle hydration fallback');
assert.equal(hydrationTexts[2], 'already-present', 'expected existing chunk text to be preserved');

const unresolvedTexts = [undefined];
const unresolvedCount = hydrateMissingChunkTextsFromBundle({
  items: [{ chunk: { id: 8, start: 1, end: 2, chunkId: 'no-hit' } }],
  chunkCodeTexts: unresolvedTexts,
  bundleChunks: [{ id: 9, start: 1, end: 2, chunkId: 'other' }]
});
assert.equal(unresolvedCount, 1, 'expected unresolved count when bundle contains no matching chunk text');

console.log('chunk text lookup map test passed');
