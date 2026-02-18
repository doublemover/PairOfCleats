#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/shared/meta-v2.js';

const chunk = {
  file: 'docs/sample.pdf',
  ext: '.pdf',
  fileHash: 'abc123',
  fileHashAlgo: 'sha256',
  start: 0,
  end: 512,
  startLine: 1,
  endLine: 18,
  kind: 'DocumentParagraph',
  name: 'sample',
  segment: {
    segmentId: 'segdoc:v1:pdf:1-2:deadbeef0000',
    segmentUid: 'segdoc:v1:pdf:1-2:deadbeef0000',
    type: 'pdf',
    sourceType: 'pdf',
    pageStart: 1,
    pageEnd: 2,
    anchor: 'pdf:1-2:deadbeef0000',
    windowIndex: 0,
    embeddingContext: 'prose'
  }
};

const meta = buildMetaV2({
  chunk,
  docmeta: {
    signature: 'Sample PDF section',
    doc: 'Sample extracted prose payload.'
  },
  toolInfo: {
    tool: 'pairofcleats',
    version: '0.0.0-test',
    configHash: 'meta-v2-test'
  }
});

assert.ok(meta, 'expected metadata output');
assert.equal(meta.schemaVersion, META_V2_SCHEMA_VERSION, 'expected schemaVersion v3');
assert.equal(meta.segment?.sourceType, 'pdf', 'expected sourceType');
assert.equal(meta.segment?.pageStart, 1, 'expected pageStart');
assert.equal(meta.segment?.pageEnd, 2, 'expected pageEnd');
assert.equal(meta.segment?.windowIndex, 0, 'expected windowIndex');
assert.equal(meta.segment?.anchor, 'pdf:1-2:deadbeef0000', 'expected anchor');
assert.equal(meta.segment?.paragraphStart, null, 'expected paragraphStart null for PDF');
assert.equal(meta.segment?.paragraphEnd, null, 'expected paragraphEnd null for PDF');

console.log('metaV2 extracted document metadata test passed');
