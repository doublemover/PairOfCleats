#!/usr/bin/env node
import assert from 'node:assert/strict';
import { smartChunk } from '../src/index/chunking.js';
import { buildMetaV2 } from '../src/index/metadata-v2.js';

const lineText = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf'
].join('\n') + '\n';
const lineContext = { chunking: { maxLines: 3 } };

const first = smartChunk({
  text: lineText,
  ext: '.js',
  relPath: 'src/sample.js',
  mode: 'code',
  context: lineContext
});
const second = smartChunk({
  text: lineText,
  ext: '.js',
  relPath: 'src/sample.js',
  mode: 'code',
  context: lineContext
});

assert.ok(first.length > 1, 'expected line splitting');

const countLines = (value) => {
  if (!value) return 0;
  const trimmed = value.endsWith('\n') ? value.slice(0, -1) : value;
  return trimmed ? trimmed.split('\n').length : 0;
};

for (const chunk of first) {
  const slice = lineText.slice(chunk.start, chunk.end);
  const lineCount = countLines(slice);
  assert.ok(lineCount <= 3, `chunk line count ${lineCount} exceeds maxLines`);
}

const segment = {
  segmentId: 'seg-1',
  type: 'code',
  languageId: 'javascript',
  parentSegmentId: null
};
const toChunkId = (chunk) => buildMetaV2({
  chunk: {
    ...chunk,
    file: 'src/sample.js',
    ext: '.js',
    segment
  },
  docmeta: {}
}).chunkId;

assert.deepEqual(first.map(toChunkId), second.map(toChunkId), 'expected stable chunk IDs');

const byteText = 'abcdefghijABCDEFGHIJ';
const byteChunks = smartChunk({
  text: byteText,
  ext: '.txt',
  relPath: 'notes.txt',
  mode: 'code',
  context: { chunking: { maxBytes: 7 } }
});

assert.ok(byteChunks.length > 1, 'expected byte splitting');
for (const chunk of byteChunks) {
  const slice = byteText.slice(chunk.start, chunk.end);
  const bytes = Buffer.byteLength(slice, 'utf8');
  assert.ok(bytes <= 7, `chunk byte count ${bytes} exceeds maxBytes`);
}

console.log('chunking limits test passed');
