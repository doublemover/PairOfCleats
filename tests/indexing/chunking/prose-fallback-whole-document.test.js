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

assert.equal(proseChunks.length, 1, 'expected prose html fallback to keep a whole-document chunk');
assert.equal(proseChunks[0].start, 0, 'expected prose html chunk to start at file start');
assert.equal(proseChunks[0].end, text.length, 'expected prose html chunk to span the full file');

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

console.log('prose fallback whole-document test passed');
