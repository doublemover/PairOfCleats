#!/usr/bin/env node
import { applyChunkingLimits } from '../../../src/index/chunking/limits.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const lineText = [
  'alpha',
  'bravo',
  'charlie',
  'delta'
].join('\n');

const baseChunk = { start: 0, end: lineText.length, name: 'root', kind: 'Section', meta: {} };
const lineChunks = applyChunkingLimits([baseChunk], lineText, { chunking: { maxLines: 2 } });

expect(lineChunks.length === 2, `Expected 2 chunks for maxLines, got ${lineChunks.length}`);
lineChunks.forEach((chunk) => {
  expect(chunk.meta?.startLine >= 1, 'Expected startLine in chunk meta.');
  expect(chunk.meta?.endLine >= chunk.meta?.startLine, 'Expected endLine >= startLine.');
});

const byteText = 'abcdefghij';
const byteChunks = applyChunkingLimits(
  [{ start: 0, end: byteText.length, name: 'root', kind: 'Section', meta: {} }],
  byteText,
  { chunking: { maxBytes: 4 } }
);

expect(byteChunks.length >= 3, `Expected multiple chunks for maxBytes, got ${byteChunks.length}`);
byteChunks.forEach((chunk) => {
  const slice = byteText.slice(chunk.start, chunk.end);
  expect(Buffer.byteLength(slice, 'utf8') <= 4, 'Chunk exceeded maxBytes.');
});

console.log('Chunking limits test passed.');
