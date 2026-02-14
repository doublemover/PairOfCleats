#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeMetaV2ForRead } from '../../../src/shared/meta-v2.js';

const input = {
  schemaVersion: 99,
  chunkId: 'chunk-1',
  file: 'docs/sample.docx',
  futureField: { enabled: true },
  segment: {
    type: 'docx',
    paragraphStart: '5',
    paragraphEnd: '7',
    anchor: 'docx:5-7:abcdef123456',
    futureSegmentField: 'keep'
  }
};

const normalized = normalizeMetaV2ForRead(input);
assert.ok(normalized, 'expected normalized metadata');
assert.equal(normalized.schemaVersion, 99, 'expected forward schemaVersion to be preserved');
assert.equal(normalized.segment?.sourceType, 'docx', 'expected inferred sourceType from segment.type');
assert.equal(normalized.segment?.paragraphStart, 5, 'expected numeric paragraphStart');
assert.equal(normalized.segment?.paragraphEnd, 7, 'expected numeric paragraphEnd');
assert.equal(normalized.segment?.anchor, 'docx:5-7:abcdef123456', 'expected anchor preserved');
assert.equal(normalized.futureField?.enabled, true, 'expected unknown top-level field preserved');
assert.equal(normalized.segment?.futureSegmentField, 'keep', 'expected unknown segment field preserved');

console.log('metaV2 unknown fields ignored test passed');
