#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildChunkMappingHintKey,
  resolveChunkSegmentAnchor,
  resolveChunkSegmentUid,
  resolveChunkStableFilePath
} from '../../../src/index/chunk-id.js';

const canonicalChunk = {
  file: 'docs/sample.pdf',
  start: 12.8,
  end: '48',
  kind: 'paragraph',
  name: 'intro',
  segment: {
    segmentUid: 'segu:v1:abc123',
    anchor: 'pdf:1-1:deadbeefcafe'
  },
  docmeta: {
    doc: 'Alpha Beta Gamma'
  }
};

const metaV2Chunk = {
  start: 12,
  end: 48,
  metaV2: {
    file: 'docs/sample.pdf',
    kind: 'paragraph',
    name: 'intro',
    doc: 'Alpha Beta Gamma',
    segment: {
      segmentUid: 'segu:v1:abc123',
      anchor: 'pdf:1-1:deadbeefcafe'
    }
  }
};

assert.equal(resolveChunkSegmentAnchor(metaV2Chunk), 'pdf:1-1:deadbeefcafe');
assert.equal(resolveChunkSegmentUid(metaV2Chunk), 'segu:v1:abc123');
assert.equal(resolveChunkStableFilePath(metaV2Chunk), 'docs/sample.pdf');

const canonicalHint = buildChunkMappingHintKey(canonicalChunk);
const metaHint = buildChunkMappingHintKey(metaV2Chunk);
assert.equal(canonicalHint, metaHint, 'expected stable hint key across canonical/metaV2 forms');

const movedChunk = { ...canonicalChunk, file: 'docs/renamed.pdf' };
assert.equal(
  buildChunkMappingHintKey(canonicalChunk),
  buildChunkMappingHintKey(movedChunk),
  'expected default hint key to remain file-agnostic'
);
assert.notEqual(
  buildChunkMappingHintKey(canonicalChunk, { includeFile: true }),
  buildChunkMappingHintKey(movedChunk, { includeFile: true }),
  'expected includeFile hint key to reflect path changes'
);

const docVariantChunk = {
  ...canonicalChunk,
  docmeta: { doc: 'Alpha Beta Delta' }
};
assert.notEqual(
  canonicalHint,
  buildChunkMappingHintKey(docVariantChunk),
  'expected doc hash component to detect changed extracted text'
);

assert.equal(buildChunkMappingHintKey(null), null, 'expected null chunk to return null hint');

console.log('chunk mapping hint key test passed');
