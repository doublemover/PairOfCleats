#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { canUseLineTokenStreamSlice } from '../../../src/index/build/file-processor/process-chunks/index.js';

const text = [
  'alpha bravo charlie delta',
  'echo foxtrot golf',
  'hotel india juliet'
].join('\n');
const lineIndex = buildLineIndex(text);

assert.equal(
  canUseLineTokenStreamSlice({
    chunkStart: 0,
    chunkEnd: text.length,
    startLine: 1,
    endLine: 3,
    lineIndex,
    fileLength: text.length
  }),
  true,
  'expected full-line chunk range to use line-stream slicing'
);

const line2Start = lineIndex[1];
const line3Start = lineIndex[2];
assert.equal(
  canUseLineTokenStreamSlice({
    chunkStart: line2Start,
    chunkEnd: line3Start,
    startLine: 2,
    endLine: 2,
    lineIndex,
    fileLength: text.length
  }),
  true,
  'expected exact line-2 span to use line-stream slicing'
);

assert.equal(
  canUseLineTokenStreamSlice({
    chunkStart: 0,
    chunkEnd: 5,
    startLine: 1,
    endLine: 1,
    lineIndex,
    fileLength: text.length
  }),
  false,
  'expected partial-line start/end span to skip line-stream slicing'
);

assert.equal(
  canUseLineTokenStreamSlice({
    chunkStart: line2Start + 2,
    chunkEnd: line3Start,
    startLine: 2,
    endLine: 2,
    lineIndex,
    fileLength: text.length
  }),
  false,
  'expected partial-line start to skip line-stream slicing'
);

console.log('line-stream boundary gating test passed');

