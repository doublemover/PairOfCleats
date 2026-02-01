#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { chunkSegments } from '../../../src/index/segments.js';

const source = [
  '```tsx',
  'const View = () => <div />;',
  '```'
].join('\n');

const segmentStart = source.indexOf('const');
const segmentEnd = source.lastIndexOf('```');

const segments = [
  {
    segmentId: 'seg-tsx',
    segmentUid: null,
    type: 'embedded',
    languageId: 'tsx',
    start: segmentStart,
    end: segmentEnd,
    parentSegmentId: null,
    meta: {}
  }
];

const chunks = chunkSegments({
  text: source,
  ext: '.md',
  relPath: 'sample.md',
  mode: 'code',
  segments,
  lineIndex: buildLineIndex(source)
});

assert.ok(chunks.length > 0, 'expected at least one chunk from embedded segment');
const embedded = chunks.find((chunk) => chunk.segment?.segmentId === 'seg-tsx');
assert.ok(embedded, 'expected embedded segment chunk');
assert.equal(embedded.segment.languageId, 'tsx', 'segment languageId should be preserved');
assert.equal(embedded.segment.ext, '.tsx', 'segment ext should reflect embedded language');

console.log('segment language fidelity test passed');
