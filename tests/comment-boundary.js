#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignCommentsToChunks } from '../src/index/build/file-processor/chunk.js';

const chunks = [
  { start: 0, end: 10 },
  { start: 10, end: 20 }
];

const comments = [
  { start: 25, end: 30, text: 'tail' },
  { start: 0, end: 2, text: 'head' },
  { start: 10, end: 12, text: 'boundary' }
];

const assignments = assignCommentsToChunks(comments, chunks);
assert.equal(assignments.get(0)?.length, 1, 'expected first comment on chunk 0');
assert.equal(assignments.get(1)?.length, 2, 'expected boundary and tail comments on chunk 1');
assert.equal(assignments.get(0)?.[0]?.text, 'head');
assert.equal(assignments.get(1)?.[0]?.text, 'boundary');

console.log('comment boundary test passed');
