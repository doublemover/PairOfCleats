#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';

const fileRelPath = 'src/sample.js';
const prefix = 'A'.repeat(200);
const chunkText = 'function greet() { return 1; }\n';
const suffix = 'B'.repeat(200);
const fileText = `${prefix}${chunkText}${suffix}`;

const chunk = {
  file: fileRelPath,
  start: prefix.length,
  end: prefix.length + chunkText.length,
  kind: 'FunctionDeclaration',
  name: 'greet'
};

await assignChunkUids({
  chunks: [chunk],
  fileText,
  fileRelPath,
  strict: true
});

const originalUid = chunk.chunkUid;
assert.ok(originalUid, 'expected chunkUid for original chunk');

const inserted = '// header comment\n// another line\n';
const updatedText = `${inserted}${fileText}`;
const shiftedChunk = {
  file: fileRelPath,
  start: prefix.length + inserted.length,
  end: prefix.length + inserted.length + chunkText.length,
  kind: 'FunctionDeclaration',
  name: 'greet'
};

await assignChunkUids({
  chunks: [shiftedChunk],
  fileText: updatedText,
  fileRelPath,
  strict: true
});

assert.equal(
  shiftedChunk.chunkUid,
  originalUid,
  'expected chunkUid to remain stable when shift is outside context window'
);

console.log('chunkUid stability lineshift test passed');
