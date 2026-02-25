#!/usr/bin/env node
import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking.js';

const text = Array.from({ length: 1200 }, (_, index) => `<p>line ${index} requestbuilder</p>`).join('\n');

const proseChunks = smartChunk({
  text,
  ext: '.html',
  relPath: 'docs/sample.html',
  mode: 'prose',
  context: {}
});

assert.ok(
  proseChunks.length > 1,
  'expected prose html fallback to honor default chunking guardrails'
);
assert.equal(proseChunks[0].start, 0, 'expected prose html chunk to start at file start');
assert.equal(
  proseChunks[proseChunks.length - 1].end,
  text.length,
  'expected prose html chunks to span the full file'
);

const byteLimitedChunks = smartChunk({
  text,
  ext: '.html',
  relPath: 'docs/sample.html',
  mode: 'prose',
  context: { chunking: { maxBytes: 1024 } }
});

assert.ok(byteLimitedChunks.length > 1, 'expected prose html fallback to honor byte chunk limits');
for (const chunk of byteLimitedChunks) {
  const slice = text.slice(chunk.start, chunk.end);
  const bytes = Buffer.byteLength(slice, 'utf8');
  assert.ok(bytes <= 1024, `chunk byte count ${bytes} exceeds maxBytes`);
}

const largeText = `${text}\n${text}\n${text}\n${text}`;
const largeChunks = smartChunk({
  text: largeText,
  ext: '.html',
  relPath: 'docs/large-sample.html',
  mode: 'prose',
  context: {}
});
assert.ok(largeChunks.length > 1, 'expected large prose fallback documents to split into multiple chunks');
assert.equal(largeChunks[0].start, 0, 'expected first large prose chunk to start at 0');
assert.equal(
  largeChunks[largeChunks.length - 1].end,
  largeText.length,
  'expected final large prose chunk to end at file end'
);

console.log('prose fallback whole-document test passed');
