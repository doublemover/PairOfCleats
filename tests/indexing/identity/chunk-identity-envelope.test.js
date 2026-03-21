#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assertChunkIdentityEnvelope,
  assertSegmentIdentityEnvelope,
  buildChunkIdentityEnvelopeFromArtifactRow
} from '../../../src/shared/identity.js';

const row = {
  id: 7,
  chunkUid: 'ck64:v1:repo:src/app.js#seg:segu:v1:abcd1234:0011223344556677',
  chunkId: 'chunk_7',
  file: 'src/app.js',
  virtualPath: 'src/app.js#seg:segu:v1:abcd1234',
  start: 12,
  end: 48,
  metaV2: {
    segment: {
      segmentUid: 'segu:v1:abcd1234',
      segmentId: 'seg-7',
      languageId: 'javascript'
    }
  }
};

const identity = buildChunkIdentityEnvelopeFromArtifactRow(row);
assert.equal(identity.docId, 7);
assert.equal(identity.chunkUid, row.chunkUid);
assert.equal(identity.virtualPath, row.virtualPath);
assert.equal(identity.segmentUid, 'segu:v1:abcd1234');
assert.deepEqual(identity.range, { start: 12, end: 48 });

const assertedChunk = assertChunkIdentityEnvelope(identity, {
  label: 'chunk_meta',
  requireChunkUid: true,
  requireVirtualPath: true,
  requireSegmentUid: true
});
assert.equal(assertedChunk.chunkUid, row.chunkUid);

const assertedSegment = assertSegmentIdentityEnvelope({
  segmentUid: identity.segmentUid,
  virtualPath: identity.virtualPath
}, {
  label: 'segment',
  requireSegmentUid: true,
  requireVirtualPath: true
});
assert.equal(assertedSegment.segmentUid, identity.segmentUid);

assert.throws(
  () => assertChunkIdentityEnvelope({ virtualPath: 'src/missing.js' }, {
    label: 'chunk_meta',
    requireChunkUid: true
  }),
  /chunk_meta missing chunkUid/
);

console.log('chunk identity envelope test passed');
