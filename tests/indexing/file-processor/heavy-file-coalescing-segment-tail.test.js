#!/usr/bin/env node
import assert from 'node:assert/strict';
import { coalesceHeavyChunks } from '../../../src/index/build/file-processor/process-chunks/index.js';

const chunks = [
  {
    start: 0,
    end: 10,
    segment: { languageId: 'javascript', ext: '.js', segmentUid: 'seg-0' },
    segmentUid: 'seg-0',
    kind: 'code',
    name: 'chunk_0'
  },
  {
    start: 10,
    end: 20,
    segment: { languageId: 'javascript', ext: '.js', segmentUid: 'seg-1' },
    segmentUid: 'seg-1',
    kind: 'code',
    name: 'chunk_1'
  },
  {
    start: 20,
    end: 30,
    segment: { languageId: 'markdown', ext: '.md', segmentUid: 'seg-2' },
    segmentUid: 'seg-2',
    kind: 'code',
    name: 'chunk_2'
  },
  {
    start: 30,
    end: 40,
    segment: { languageId: 'markdown', ext: '.md', segmentUid: 'seg-3' },
    segmentUid: 'seg-3',
    kind: 'code',
    name: 'chunk_3'
  },
  {
    start: 40,
    end: 50,
    segment: { languageId: 'toml', ext: '.toml', segmentUid: 'seg-tail' },
    segmentUid: 'seg-tail',
    kind: 'code',
    name: 'chunk_tail'
  }
];

const coalesced = coalesceHeavyChunks(chunks, 4);
assert.equal(coalesced.length, 3, 'expected 5 chunks to coalesce into 3 buckets with target=4');
assert.equal(coalesced[0]?.segment, undefined, 'expected merged bucket to drop segment metadata');
assert.equal(coalesced[1]?.segment, undefined, 'expected merged bucket to drop segment metadata');
assert.equal(
  coalesced[2]?.segment?.languageId,
  'toml',
  'expected single-chunk tail bucket to preserve segment metadata'
);
assert.equal(
  coalesced[2]?.segmentUid,
  'seg-tail',
  'expected single-chunk tail bucket to preserve segmentUid'
);

console.log('heavy file coalescing segment-tail test passed');
